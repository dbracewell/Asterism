"""Regressions for the per-kind extraction rows of a knowledge artifact.

The artifact reports its derived outputs as a map keyed by kind, the retrieval
path keeps reading a single denormalized row, and the payloads are typed per
kind at the application boundary.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from asterism.db.model_registry import Base
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.files.service import get_file_knowledge_status
from asterism.domains.files.store import get_file_store
from asterism.domains.knowledge.extractions import (
    describe_artifact,
    load_artifact_extractions,
)
from asterism.domains.knowledge.models import (
    FileKnowledgeArtifactModel,
    FileKnowledgeExtractionModel,
    KnowledgeExtractionKind,
    KnowledgeExtractionStatus,
)
from asterism.domains.knowledge.schemas import FileKnowledgeArtifact
from asterism.domains.user.models import UserModel
from pydantic import ValidationError
from sqlalchemy import delete, event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def extraction_session(tmp_path, monkeypatch):
    from asterism.core import config
    from asterism.db.database import set_sqlite_pragma

    monkeypatch.setattr(config, "storage_root", tmp_path)
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'extractions.db'}")
    # The application enables SQLite's foreign-key enforcement on every
    # connection, so the cascade that removes an artifact's derived outputs is
    # part of the behavior under test.
    event.listen(engine.sync_engine, "connect", set_sqlite_pragma)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add(UserModel(id="user-a"))
        await session.commit()
        yield session
    await engine.dispose()


async def _upload(session, *, name: str = "notes.txt", kind: FileKind = FileKind.TEXT):
    file = UserFileModel(
        storage_key=str(uuid.uuid4()),
        user_id="user-a",
        filename=name,
        original_name=name,
        size=11,
        mime_type="text/plain",
        kind=kind,
        sha256="b" * 64,
    )
    session.add(file)
    await session.flush()
    file.storage_key = get_file_store().save("user-a", file.id, ".txt", b"hello world")
    return file


async def _artifact(session, file, **overrides):
    artifact = FileKnowledgeArtifactModel(
        id=uuid.uuid4(),
        user_id="user-a",
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        processing_profile_identity="a" * 64,
        status=KnowledgeExtractionStatus.READY,
        is_current=True,
        **overrides,
    )
    session.add(artifact)
    await session.commit()
    return artifact


@pytest.mark.asyncio
async def test_artifact_reports_one_extraction_per_kind(extraction_session):
    """Each derived output is reported under its own kind."""
    file = await _upload(extraction_session)
    artifact = await _artifact(extraction_session, file, searchable=True)
    extraction_session.add_all(
        [
            FileKnowledgeExtractionModel(
                artifact_id=artifact.id,
                kind=KnowledgeExtractionKind.TEXT_EXTRACTION,
                status=KnowledgeExtractionStatus.READY,
                provider="markitdown",
                payload={"content": "hello world"},
            ),
            FileKnowledgeExtractionModel(
                artifact_id=artifact.id,
                kind=KnowledgeExtractionKind.EMBEDDING,
                status=KnowledgeExtractionStatus.READY,
                provider="onnx-clip",
                payload={"text_ready": True, "visual_ready": False},
            ),
        ]
    )
    await extraction_session.commit()

    extractions = await load_artifact_extractions(
        artifact_id=artifact.id,
        session=extraction_session,
    )
    described = describe_artifact(artifact, list(extractions.values()))

    assert set(described.extractions) == {"text_extraction", "embedding"}
    assert described.extractions["text_extraction"].payload.content == "hello world"
    assert described.extractions["text_extraction"].provider == "markitdown"
    assert described.extractions["embedding"].payload.text_ready is True
    assert described.extractions["embedding"].payload.visual_ready is False


@pytest.mark.asyncio
async def test_one_extraction_per_kind_is_enforced_by_the_database(extraction_session):
    """An artifact owns at most one row per kind."""
    from sqlalchemy.exc import IntegrityError

    file = await _upload(extraction_session)
    artifact = await _artifact(extraction_session, file)
    extraction_session.add(
        FileKnowledgeExtractionModel(
            artifact_id=artifact.id,
            kind=KnowledgeExtractionKind.EMBEDDING,
            status=KnowledgeExtractionStatus.PENDING,
        )
    )
    await extraction_session.commit()

    extraction_session.add(
        FileKnowledgeExtractionModel(
            artifact_id=artifact.id,
            kind=KnowledgeExtractionKind.EMBEDDING,
            status=KnowledgeExtractionStatus.PENDING,
        )
    )
    with pytest.raises(IntegrityError):
        await extraction_session.commit()
    await extraction_session.rollback()


@pytest.mark.asyncio
async def test_removing_an_artifact_removes_its_derived_outputs(extraction_session):
    """A deleted artifact leaves no orphaned derived outputs behind."""
    file = await _upload(extraction_session)
    artifact = await _artifact(extraction_session, file)
    extraction_session.add(
        FileKnowledgeExtractionModel(
            artifact_id=artifact.id,
            kind=KnowledgeExtractionKind.EMBEDDING,
            status=KnowledgeExtractionStatus.PENDING,
        )
    )
    await extraction_session.commit()

    await extraction_session.execute(
        delete(FileKnowledgeArtifactModel).where(FileKnowledgeArtifactModel.id == artifact.id)
    )
    await extraction_session.commit()

    assert (
        await extraction_session.scalars(
            select(FileKnowledgeExtractionModel).where(FileKnowledgeExtractionModel.artifact_id == artifact.id)
        )
    ).all() == []


@pytest.mark.asyncio
async def test_a_payload_that_does_not_match_its_kind_fails_loudly(extraction_session):
    """A corrupt payload is rejected instead of surfacing as a wrong shape."""
    file = await _upload(extraction_session)
    artifact = await _artifact(extraction_session, file)
    extraction_session.add(
        FileKnowledgeExtractionModel(
            artifact_id=artifact.id,
            kind=KnowledgeExtractionKind.CAPTIONING,
            status=KnowledgeExtractionStatus.READY,
            payload={"unexpected": "field"},
        )
    )
    await extraction_session.commit()

    extractions = await load_artifact_extractions(
        artifact_id=artifact.id,
        session=extraction_session,
    )
    with pytest.raises(ValidationError):
        describe_artifact(artifact, list(extractions.values()))


@pytest.mark.asyncio
async def test_the_file_library_reports_the_extractions_map(extraction_session):
    """The file library's knowledge summary carries the per-kind outputs."""
    file = await _upload(extraction_session)
    artifact = await _artifact(extraction_session, file, searchable=True)
    extraction_session.add(
        FileKnowledgeExtractionModel(
            artifact_id=artifact.id,
            kind=KnowledgeExtractionKind.TEXT_EXTRACTION,
            status=KnowledgeExtractionStatus.READY,
            payload={"content": "hello world"},
        )
    )
    await extraction_session.commit()

    reported = await get_file_knowledge_status(
        user_id="user-a",
        filename=file.filename,
        session=extraction_session,
    )

    assert isinstance(reported, FileKnowledgeArtifact)
    assert set(reported.extractions) == {"text_extraction"}
    assert reported.extractions["text_extraction"].payload.content == "hello world"


@pytest.mark.asyncio
async def test_caption_reports_its_own_execution_times(extraction_session):
    """Caption completion can follow ingestion without inheriting its times."""
    file = await _upload(extraction_session, kind=FileKind.IMAGE)
    artifact = await _artifact(extraction_session, file, started_at=100, completed_at=110)
    extraction_session.add(
        FileKnowledgeExtractionModel(
            artifact_id=artifact.id,
            kind=KnowledgeExtractionKind.CAPTIONING,
            status=KnowledgeExtractionStatus.READY,
            payload={"text": "A red square"},
            started_at=120,
            completed_at=140,
        )
    )
    await extraction_session.commit()

    reported = await get_file_knowledge_status(
        user_id="user-a",
        filename=file.filename,
        session=extraction_session,
    )

    assert reported is not None
    assert (reported.started_at, reported.completed_at) == (100, 110)
    caption = reported.extractions["captioning"].model_dump(mode="json")
    assert caption["started_at"] == 120
    assert caption["completed_at"] == 140
    assert caption["status"] == "ready"
    assert "generated_at" not in caption
    assert "accepted_at" not in caption


@pytest.mark.asyncio
async def test_retrieval_reads_only_the_artifact_row(extraction_session):
    """The retrieval hot path stays a single-row read.

    The searchable aggregate is denormalized on the artifact row, so retrieval
    never has to join the extraction rows. An artifact with no derived outputs
    at all is still served.
    """
    from asterism.domains.agent.execution_scope import ExecutionScope
    from asterism.domains.retrieval.service import (
        RetrievalArtifact,
        RetrievalLimits,
        RetrievalService,
    )

    file = await _upload(extraction_session)
    await _artifact(extraction_session, file, searchable=True)

    artifact = await extraction_session.scalar(
        select(FileKnowledgeArtifactModel).where(FileKnowledgeArtifactModel.file_id == file.id)
    )
    assert artifact is not None
    # The artifact has no extraction rows at all.
    assert (
        await extraction_session.scalars(
            select(FileKnowledgeExtractionModel).where(FileKnowledgeExtractionModel.artifact_id == artifact.id)
        )
    ).all() == []

    scope = ExecutionScope(
        user_id="user-a",
        user_profile_id=None,
        agent_id=uuid.UUID(int=1),
        is_sub_agent=False,
        chat_id=uuid.UUID(int=2),
        project_id=None,
        selected_model=None,
        executed_model=None,
        eligible_sub_agent_ids=frozenset(),
        effective_internal_tools=frozenset({"search_knowledge"}),
        active_branch_message_ids=(),
        configuration_revision=1,
        prompt_revision=None,
        allowed_file_ids=frozenset({file.id}),
        file_provenance=(),
    )
    embeddings = SimpleNamespace(embed_text=AsyncMock(return_value=[[0.1]]))
    vectors = SimpleNamespace(
        search=AsyncMock(
            return_value=[
                SimpleNamespace(
                    id="chunk-1",
                    user_id="user-a",
                    file_id=str(file.id),
                    artifact_generation=1,
                    chunk_ordinal=0,
                    kind="text",
                    content="hello world",
                    score=0.1,
                )
            ]
        )
    )
    service = RetrievalService(
        read_scope=AsyncMock(
            return_value=SimpleNamespace(
                files=(
                    SimpleNamespace(
                        file_id=file.id,
                        filename=file.filename,
                        sources=("project",),
                        message_ids=(),
                    ),
                ),
                artifacts=(
                    RetrievalArtifact(
                        file_id=file.id,
                        generation=1,
                        status=KnowledgeExtractionStatus.READY,
                        searchable=True,
                    ),
                ),
                context_revision=1,
            )
        ),
        embeddings=embeddings,
        vectors=vectors,
        limits=RetrievalLimits(top_k=5, allowed_files=10, result_bytes=1000),
    )

    result = await service.search(scope, query="hello")

    assert [hit.excerpt for hit in result.results] == ["hello world"]
    assert vectors.search.call_args.kwargs["allowed_file_ids"] == [str(file.id)]
