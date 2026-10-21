import hashlib
import uuid
from contextlib import asynccontextmanager
from io import BytesIO
from types import SimpleNamespace

import pytest
import pytest_asyncio
from asterism.core import config
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.db.model_registry import Base
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.chat.schemas import Chat, ChatInfo, Message, MessageFileReference, MessageStatus
from asterism.domains.extraction.models import FileExtractionModel, FileKnowledgeArtifactStatus
from asterism.domains.extraction.vector_store import LanceDbVectorStore, VectorChunk
from asterism.domains.files.models import FileContentStatus, FileKind, UserFileModel
from asterism.domains.files.processor import MarkItDownFileProcessor
from asterism.domains.files.service import (
    cancel_file_knowledge_processing,
    delete_user_file,
    ensure_file_processed,
    get_file_knowledge_status,
    get_similar_files,
    get_user_file,
    list_user_files,
    regenerate_file_knowledge,
    upload_files,
)
from asterism.domains.files.store import get_file_store
from asterism.domains.llm.schemas import ImageUrlContentPart, text_content
from asterism.domains.user.models import UserModel
from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.datastructures import UploadFile


def _upload(name: str, content: bytes) -> UploadFile:
    return UploadFile(filename=name, file=BytesIO(content))


@pytest_asyncio.fixture
async def file_session(tmp_path, monkeypatch):
    database = tmp_path / "files.db"
    monkeypatch.setattr(config, "storage_root", tmp_path)
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all([UserModel(id="user-a"), UserModel(id="user-b")])
        await session.commit()
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_upload_deduplicates_classifies_and_scopes_files(file_session):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[
            _upload("../report.txt", b"first"),
            _upload("report.txt", b"second"),
            _upload("photo.png", b"\x89PNG\r\n\x1a\ncontent"),
        ],
        session=file_session,
    )

    assert [file.filename for file in uploaded.files] == [
        "report.txt",
        "report(2).txt",
        "photo.png",
    ]
    assert [file.kind for file in uploaded.files] == [
        FileKind.TEXT,
        FileKind.TEXT,
        FileKind.IMAGE,
    ]
    assert uploaded.files[0].mime_type == "text/plain"
    assert uploaded.files[2].mime_type == "image/png"
    artifacts = list(
        await file_session.scalars(
            select(FileExtractionModel).where(FileExtractionModel.user_id == "user-a"),
        ),
    )
    assert {(artifact.file_id, artifact.status, artifact.is_current) for artifact in artifacts} == {
        (file.id, FileKnowledgeArtifactStatus.PENDING, False) for file in uploaded.files
    }
    assert (await source_path(file_session, uploaded.files[0])).read_bytes() == b"first"
    assert (await list_user_files(user_id="user-b", session=file_session)).files == []


@pytest.mark.asyncio
async def test_upload_reuses_same_user_filename_and_hash_without_copy(file_session):
    first = await upload_files(
        user_id="user-a",
        uploads=[_upload("report.txt", b"same bytes")],
        session=file_session,
    )
    repeated = await upload_files(
        user_id="user-a",
        uploads=[_upload("report.txt", b"same bytes"), _upload("report.txt", b"same bytes")],
        session=file_session,
    )
    other_user = await upload_files(
        user_id="user-b",
        uploads=[_upload("report.txt", b"same bytes")],
        session=file_session,
    )

    user_files = list(
        await file_session.scalars(select(UserFileModel).where(UserFileModel.user_id == "user-a")),
    )
    assert [file.id for file in repeated.files] == [first.files[0].id]
    assert [file.filename for file in user_files] == ["report.txt"]
    assert other_user.files[0].id != first.files[0].id
    assert len(list(config.files_root.rglob("source.*"))) == 2


@pytest.mark.asyncio
async def test_upload_rejects_unsafe_extensions_and_size(file_session, monkeypatch):
    with pytest.raises(BadDataException, match="not allowed"):
        await upload_files(
            user_id="user-a",
            uploads=[_upload("bad.exe", b"x")],
            session=file_session,
        )

    monkeypatch.setattr(config, "max_upload_file_size_bytes", 3)
    with pytest.raises(BadDataException, match="exceeds"):
        await upload_files(
            user_id="user-a",
            uploads=[_upload("large.txt", b"four")],
            session=file_session,
        )
    assert list(config.files_root.rglob("source.*")) == []


@pytest.mark.asyncio
async def test_delete_is_user_scoped_and_download_remains_available(file_session):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("keep.txt", b"content")],
        session=file_session,
    )
    filename = uploaded.files[0].filename

    with pytest.raises(NotFoundException):
        await delete_user_file(user_id="user-b", filename=filename, session=file_session)

    response = await get_user_file("user-a", filename, session=file_session)
    assert response.path == await source_path(file_session, uploaded.files[0])
    content_hash = hashlib.sha256(b"content").hexdigest()
    assert response.headers["Cache-Control"] == "private, no-cache"
    assert response.headers["ETag"] == f'"{content_hash}"'

    # Verify 304 Not Modified when ETag matches
    not_modified = await get_user_file("user-a", filename, session=file_session, if_none_match=f'"{content_hash}"')
    assert not_modified.status_code == 304
    assert not_modified.headers["ETag"] == f'"{content_hash}"'
    assert not_modified.headers["Cache-Control"] == "private, no-cache"

    path = response.path
    deleted = await delete_user_file(user_id="user-a", filename=filename, session=file_session)
    assert deleted.filename == filename
    assert not path.exists()
    assert await file_session.scalar(select(UserFileModel.id)) is None


@pytest.mark.asyncio
async def test_delete_file_cancels_artifacts_and_removes_vectors_and_bytes(file_session, monkeypatch):
    class FakeVectors:
        def __init__(self):
            self.deleted: list[tuple[str, str]] = []

        async def delete_file(self, *, user_id: str, file_id: str):
            self.deleted.append((user_id, file_id))

    vectors = FakeVectors()
    monkeypatch.setattr("asterism.domains.extraction.runtime.vector_store", vectors)
    cancelled: list[str] = []

    async def cancel_jobs(artifact_id):
        cancelled.append(str(artifact_id))

    monkeypatch.setattr("asterism.domains.extraction.runtime.cancel_file_jobs", cancel_jobs)

    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("knowledge.txt", b"private knowledge")],
        session=file_session,
    )
    file = uploaded.files[0]
    artifact = await file_session.scalar(
        select(FileExtractionModel).where(FileExtractionModel.file_id == file.id),
    )
    assert artifact is not None
    path = await source_path(file_session, file)
    await delete_user_file(user_id="user-a", filename=file.filename, session=file_session)

    assert cancelled == [str(artifact.id)]
    assert vectors.deleted == [("user-a", str(file.id))]
    assert (
        await file_session.scalar(
            select(FileExtractionModel.id).where(FileExtractionModel.file_id == file.id),
        )
        is None
    )
    assert not path.exists()


@pytest.mark.asyncio
async def test_file_knowledge_status_cancel_and_retry_reuse_one_generation(file_session, monkeypatch):
    cancelled: list[str] = []
    enqueued: list[str] = []

    async def cancel_jobs(artifact_id):
        cancelled.append(str(artifact_id))

    def start_ingestion_job(*, artifact_id, **_):
        enqueued.append(str(artifact_id))
        return True

    monkeypatch.setattr("asterism.domains.extraction.runtime.cancel_file_jobs", cancel_jobs)
    monkeypatch.setattr("asterism.domains.extraction.runtime.start_file_ingestion_job", start_ingestion_job)
    monkeypatch.setattr("asterism.domains.files.processing.start_file_ingestion_job", start_ingestion_job)
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("retry.txt", b"retry me")],
        session=file_session,
    )
    file = uploaded.files[0]
    status = await get_file_knowledge_status(user_id="user-a", filename=file.filename, session=file_session)
    assert status.status == "pending"

    canceled = await cancel_file_knowledge_processing(user_id="user-a", filename=file.filename, session=file_session)
    assert canceled.status == "canceled"
    retried = await regenerate_file_knowledge(user_id="user-a", filename=file.filename, session=file_session)
    assert (retried.id, retried.generation, retried.status) == (status.id, 1, "pending")
    assert cancelled == [str(status.id)] * 2
    assert enqueued == [str(status.id), str(status.id)]


@pytest.mark.asyncio
async def test_similar_files_rank_by_cosine_and_stay_user_scoped(file_session, monkeypatch, tmp_path):
    store = LanceDbVectorStore(tmp_path / "vectors", dimension=2, max_concurrency=1)
    monkeypatch.setattr("asterism.domains.extraction.runtime.vector_store", store)
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload(name, name.encode()) for name in ("src.txt", "near.txt", "far.txt", "stale.txt")],
        session=file_session,
    )
    other = await upload_files(user_id="user-b", uploads=[_upload("theirs.txt", b"theirs")], session=file_session)
    by_name = {file.filename: file for file in [*uploaded.files, *other.files]}
    vectors = {
        "src.txt": [1.0, 0.0],
        "near.txt": [0.8, 0.6],
        "far.txt": [0.0, 1.0],
        "stale.txt": [1.0, 0.0],
        "theirs.txt": [1.0, 0.0],
    }
    owners = {"theirs.txt": "user-b"}
    for name, vector in vectors.items():
        artifact = await file_session.scalar(
            select(FileExtractionModel).where(FileExtractionModel.file_id == by_name[name].id),
        )
        assert artifact is not None
        artifact.status = FileKnowledgeArtifactStatus.READY
        artifact.is_current = name != "stale.txt"
        await store.add(
            [VectorChunk(f"{name}-0", owners.get(name, "user-a"), str(by_name[name].id), 1, 0, "text", name, vector)],
        )
    await file_session.commit()

    result = await get_similar_files(user_id="user-a", filename="src.txt", session=file_session)

    assert [item.file.filename for item in result.files] == ["near.txt", "far.txt"]
    assert result.files[0].score == pytest.approx(0.8, abs=1e-5)
    assert result.files[1].score == pytest.approx(0.0, abs=1e-5)
    assert (await get_similar_files(user_id="user-a", filename="stale.txt", session=file_session)).files == []
    with pytest.raises(NotFoundException):
        await get_similar_files(user_id="user-a", filename="theirs.txt", session=file_session)


@pytest.mark.asyncio
async def test_processing_reads_text_caches_and_invalidates(file_session):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("note.txt", b"hello\nworld")],
        session=file_session,
    )
    file = await file_session.get(UserFileModel, uploaded.files[0].id)
    assert file is not None

    processed = await ensure_file_processed(file=file, session=file_session)
    assert processed.content_status is FileContentStatus.READY
    assert processed.content_cache == "hello\nworld"

    path = get_file_store().open(processed.user_id, processed.storage_key)
    path.write_text("changed", encoding="utf-8")
    processed = await ensure_file_processed(file=processed, session=file_session)
    assert processed.content_cache == "changed"


@pytest.mark.asyncio
async def test_processing_bounds_and_unsupported_files(file_session, monkeypatch):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("large.txt", b"content"), _upload("unknown.dat", b"binary")],
        session=file_session,
    )
    monkeypatch.setattr(config, "max_process_file_size_bytes", 3)
    large = await file_session.get(UserFileModel, uploaded.files[0].id)
    unknown = await file_session.get(UserFileModel, uploaded.files[1].id)
    assert large is not None and unknown is not None

    processed_large = await ensure_file_processed(file=large, session=file_session)
    processed_unknown = await ensure_file_processed(file=unknown, session=file_session)
    assert processed_large.content_error == "File is too large to process"
    assert processed_unknown.content_status is FileContentStatus.UNSUPPORTED


def _xlsx_bytes() -> bytes:
    workbook = Workbook()
    workbook.active.append(["Column", "Spreadsheet content"])
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


@pytest.mark.asyncio
async def test_processing_converts_html_document(file_session):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("page.html", b"<h1>Heading</h1><p>Hello document</p>")],
        session=file_session,
    )
    file = await file_session.get(UserFileModel, uploaded.files[0].id)
    assert file is not None and file.kind is FileKind.DOCUMENT

    processed = await ensure_file_processed(file=file, session=file_session)
    assert processed.content_status is FileContentStatus.READY
    assert "Heading" in (processed.content_cache or "")
    assert "Hello document" in (processed.content_cache or "")


@pytest.mark.asyncio
async def test_processing_converts_a_spreadsheet_document(file_session):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("spreadsheet.xlsx", _xlsx_bytes())],
        session=file_session,
    )
    expected_content = ["Spreadsheet content"]
    for metadata, expected in zip(uploaded.files, expected_content, strict=True):
        file = await file_session.get(UserFileModel, metadata.id)
        assert file is not None and file.kind is FileKind.DOCUMENT
        processed = await ensure_file_processed(file=file, session=file_session)
        assert processed.content_status is FileContentStatus.READY
        assert expected in (processed.content_cache or "")


@pytest.mark.asyncio
async def test_processing_truncates_content_and_contains_converter_failures(
    file_session,
    monkeypatch,
):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("note.txt", b"abcdef")],
        session=file_session,
    )
    monkeypatch.setattr(config, "max_converted_chars", 4)
    file = await file_session.get(UserFileModel, uploaded.files[0].id)
    assert file is not None
    processed = await ensure_file_processed(file=file, session=file_session)
    assert processed.content_cache == "abcd\n… [content truncated]"

    document = await upload_files(
        user_id="user-a",
        uploads=[_upload("broken.pdf", b"not really a PDF")],
        session=file_session,
    )

    async def timeout(_, __):
        raise TimeoutError

    monkeypatch.setattr(MarkItDownFileProcessor, "_convert_with_timeout", timeout)
    file = await file_session.get(UserFileModel, document.files[0].id)
    assert file is not None
    processed = await ensure_file_processed(file=file, session=file_session)
    assert processed.content_status is FileContentStatus.FAILED
    assert processed.content_error == "File conversion timed out"


@pytest.mark.asyncio
async def test_processing_handles_a_missing_file(file_session):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("missing.txt", b"content")],
        session=file_session,
    )
    file = await file_session.get(UserFileModel, uploaded.files[0].id)
    assert file is not None
    (await source_path(file_session, file)).unlink()

    processed = await ensure_file_processed(file=file, session=file_session)
    assert processed.content_status is FileContentStatus.FAILED
    assert processed.content_error == "File is no longer available"


@pytest.mark.asyncio
async def test_uploaded_image_and_document_build_vision_gated_model_input(file_session, monkeypatch):
    """The upload → cache → chat-history path is deterministic without a provider."""
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[
            _upload("photo.png", b"\x89PNG\r\n\x1a\nimage"),
            _upload("report.pdf", b"not-a-real-pdf"),
            _upload("empty.txt", b""),
        ],
        session=file_session,
    )
    calls = 0

    async def convert(_, __):
        nonlocal calls
        calls += 1
        return "# Converted PDF\nRevenue: 42"

    monkeypatch.setattr(MarkItDownFileProcessor, "_convert_with_timeout", convert)
    records = [await file_session.get(UserFileModel, metadata.id) for metadata in uploaded.files]
    assert all(records)
    for record in records:
        await ensure_file_processed(file=record, session=file_session)  # type: ignore[arg-type]
    # A second attachment reuses the persisted conversion cache.
    await ensure_file_processed(file=records[1], session=file_session)  # type: ignore[arg-type]
    assert calls == 1

    references = [
        MessageFileReference(
            file_id=record.id,
            filename=record.filename,
            name=record.original_name,
            mime_type=record.mime_type,
            size=record.size,
            kind=record.kind,
            status=record.content_status,
        )
        for record in records
    ]
    chat = Chat(
        info=ChatInfo(id=uuid.uuid4(), user_id="user-a", created_at=0, updated_at=0),
        messages=[
            Message(
                id=uuid.uuid4(),
                role="user",
                content="Analyze",
                status=MessageStatus.PENDING,
                created_at=0,
                files=references,
            )
        ],
    )
    from asterism.domains.chat.models import ChatFileModel, ChatModel, MessageModel

    file_session.add(ChatModel(id=chat.info.id, user_id="user-a"))
    await file_session.flush()
    file_session.add(
        MessageModel(
            id=chat.messages[0].id,
            chat_id=chat.info.id,
            user_id="user-a",
            role="user",
            content="Analyze",
            files=references,
        )
    )
    file_session.add_all(
        [ChatFileModel(chat_id=chat.info.id, user_id="user-a", file_id=record.id) for record in records]
    )
    await file_session.commit()
    from asterism.core.schemas import AuthedUser
    from asterism.domains.agent.agent import Agent
    from asterism.domains.agent.service import get_main_agent_profile
    from asterism.domains.settings.models import LLMModel, ProviderModel
    from asterism.domains.user.service import initialize_user_settings

    provider = ProviderModel(name="Files", base_url="http://localhost/v1", api_key="test")
    file_session.add(provider)
    await file_session.flush()
    model = LLMModel(provider_id=provider.id, name="Files", is_active=True, supports_vision=True)
    file_session.add(model)
    await initialize_user_settings("user-a", file_session)
    await file_session.commit()

    @asynccontextmanager
    async def session_context(session=None):
        yield session or file_session

    for module in [
        "agent.service",
        "chat.tool_policy",
        "chat.delegation",
        "chat.runtime_files",
        "files.runtime_access",
    ]:
        monkeypatch.setattr(f"asterism.domains.{module}.get_async_db_session", session_context)
    monkeypatch.setattr("asterism.db.database.get_async_db_session", session_context)
    agent = Agent(
        profile=await get_main_agent_profile("user-a", file_session),
        user=AuthedUser(id="user-a", email="a@x.test", name="A", role="user"),
        session=chat,
        model_id=model.id,
    )
    orchestrator = ChatOrchestrator(agent)

    async def model_with_vision(**_):
        return SimpleNamespace(supports_vision=True)

    monkeypatch.setattr("asterism.domains.chat.orchestrator.settings_service.get_model_and_provider", model_with_vision)
    vision_message = (await orchestrator._build_agent_messages())[0]
    assert any(isinstance(part, ImageUrlContentPart) for part in vision_message.content)  # type: ignore[union-attr]
    assert "Converted PDF" in text_content(vision_message)
    # An empty source is still an attached source: it must not be reported as
    # missing or unsupported.
    assert "### Attached file: empty.txt" in text_content(vision_message)
    assert "not included" not in text_content(vision_message)

    async def model_without_vision(**_):
        return SimpleNamespace(supports_vision=False)

    monkeypatch.setattr(
        "asterism.domains.chat.orchestrator.settings_service.get_model_and_provider",
        model_without_vision,
    )
    non_vision_message = (await orchestrator._build_agent_messages())[0]
    assert not any(isinstance(part, ImageUrlContentPart) for part in non_vision_message.content)  # type: ignore[union-attr]
    assert "model does not support image input" in text_content(non_vision_message)


@pytest.mark.asyncio
async def test_download_rejects_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "storage_root", tmp_path)
    with pytest.raises(BadDataException):
        await get_user_file("user-a", "../secret.txt")


async def source_path(session, file):
    model = await session.get(UserFileModel, file.id)
    return get_file_store().open(model.user_id, model.storage_key)


@pytest.mark.asyncio
async def test_upload_batch_failure_rolls_back_sources_and_metadata(file_session):
    with pytest.raises(BadDataException):
        await upload_files(
            user_id="user-a", uploads=[_upload("valid.txt", b"keep"), _upload("bad.exe", b"x")], session=file_session
        )
    assert list(config.files_root.rglob("source.*")) == []
    assert await file_session.scalar(select(UserFileModel.id)) is None
    assert await file_session.scalar(select(FileExtractionModel.id)) is None


@pytest.mark.asyncio
async def test_bulk_physical_deletion_cleans_project_references_without_fk_cascades(file_session):
    from asterism.domains.files.service import delete_user_files
    from asterism.domains.projects.models import ProjectFileModel, ProjectModel

    uploaded = await upload_files(user_id="user-a", uploads=[_upload("shared.txt", b"shared")], session=file_session)
    file = uploaded.files[0]
    projects = [ProjectModel(user_id="user-a", name=name) for name in ("One", "Two")]
    file_session.add_all(projects)
    await file_session.flush()
    file_session.add_all([ProjectFileModel(user_id="user-a", project_id=p.id, file_id=file.id) for p in projects])
    await file_session.commit()
    path = await source_path(file_session, file)
    result = await delete_user_files(user_id="user-a", filenames=[file.filename], session=file_session)
    assert [p.name for p in result.files[0].projects] == ["One", "Two"]
    assert await file_session.scalar(select(ProjectFileModel.file_id)) is None
    assert not path.exists()
    for project in projects:
        await file_session.refresh(project)
        assert project.context_revision == 2
