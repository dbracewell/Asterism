from contextlib import asynccontextmanager

import pytest
import pytest_asyncio
from asterism.core import config
from asterism.core.exceptions import BadDataException, CodedException, NotFoundException
from asterism.db.base import Base
from asterism.db.schema_migrations import run_schema_migrations
from asterism.domains.files.models import FileContentStatus, FileKind, UserFileModel
from asterism.domains.knowledge.audit import KnowledgeAuditEventModel
from asterism.domains.knowledge.caption_jobs import KnowledgeCaptionJobs
from asterism.domains.knowledge.captioning import CaptionMode, CaptionResult
from asterism.domains.knowledge.ingestion import ingest_document
from asterism.domains.knowledge.models import (
    KnowledgeCaptionConfigurationModel,
    KnowledgeCaptionStatus,
    KnowledgeDocumentModel,
    KnowledgeDocumentStatus,
)
from asterism.domains.knowledge.schemas import (
    KnowledgeBaseCreate,
    KnowledgeBaseUpdate,
    KnowledgeCaptionConfigurationUpdate,
    KnowledgeCaptionUpdate,
    KnowledgeDocumentCreate,
    KnowledgeDocumentRevisionCreate,
    KnowledgeDocumentUpdate,
)
from asterism.domains.knowledge.service import (
    add_knowledge_document,
    create_knowledge_base,
    create_knowledge_document_revision,
    delete_knowledge_base,
    delete_knowledge_document,
    get_captioning_configuration,
    get_knowledge_base,
    get_knowledge_document,
    list_knowledge_bases,
    list_knowledge_documents,
    update_captioning_configuration,
    update_knowledge_base,
    update_knowledge_document_caption,
    update_knowledge_document_metadata,
)
from asterism.domains.user.models import UserModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def knowledge_session(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'knowledge-bases.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await run_schema_migrations(connection)

    class FakeVectorStore:
        async def delete_document(self, **_):
            pass

        async def delete_knowledge_base(self, **_):
            pass

    class FakeJobs:
        def cancel(self, _):
            return False

    monkeypatch.setattr("asterism.domains.knowledge.runtime.vector_store", FakeVectorStore())
    monkeypatch.setattr("asterism.domains.knowledge.runtime.knowledge_ingestion_jobs", FakeJobs())
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all([UserModel(id="user-a"), UserModel(id="user-b")])
        await session.commit()
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_knowledge_base_crud_is_owner_scoped_and_paginated(knowledge_session):
    first = await create_knowledge_base(
        user_id="user-a",
        payload=KnowledgeBaseCreate(name="  Product   Notes ", description="  Private docs  "),
        session=knowledge_session,
    )
    second = await create_knowledge_base(
        user_id="user-a", payload=KnowledgeBaseCreate(name="Archive"), session=knowledge_session
    )
    await create_knowledge_base(
        user_id="user-b", payload=KnowledgeBaseCreate(name="Private"), session=knowledge_session
    )

    assert first.name == "Product Notes"
    assert first.description == "Private docs"
    listing = await list_knowledge_bases(user_id="user-a", session=knowledge_session, page=1, page_size=1)
    assert listing.total == 2
    assert len(listing.knowledge_bases) == 1

    updated = await update_knowledge_base(
        user_id="user-a",
        knowledge_base_id=first.id,
        payload=KnowledgeBaseUpdate(name="Current notes", description=""),
        session=knowledge_session,
    )
    assert updated.name == "Current notes"
    assert updated.description is None
    fetched = await get_knowledge_base(user_id="user-a", knowledge_base_id=first.id, session=knowledge_session)
    assert fetched.id == first.id

    with pytest.raises(NotFoundException):
        await get_knowledge_base(user_id="user-b", knowledge_base_id=first.id, session=knowledge_session)
    with pytest.raises(NotFoundException):
        await delete_knowledge_base(user_id="user-b", knowledge_base_id=second.id, session=knowledge_session)

    deleted = await delete_knowledge_base(user_id="user-a", knowledge_base_id=second.id, session=knowledge_session)
    assert deleted.id == second.id
    assert (await list_knowledge_bases(user_id="user-a", session=knowledge_session, page=1, page_size=50)).total == 1


@pytest.mark.asyncio
async def test_knowledge_base_rejects_blank_and_duplicate_names(knowledge_session):
    with pytest.raises(BadDataException, match="name is required"):
        await create_knowledge_base(
            user_id="user-a", payload=KnowledgeBaseCreate(name="   "), session=knowledge_session
        )
    await create_knowledge_base(
        user_id="user-a", payload=KnowledgeBaseCreate(name="Same name"), session=knowledge_session
    )
    with pytest.raises(CodedException) as error:
        await create_knowledge_base(
            user_id="user-a", payload=KnowledgeBaseCreate(name="Same name"), session=knowledge_session
        )
    assert error.value.code == 409


@pytest.mark.asyncio
async def test_caption_configuration_is_seeded_disabled(knowledge_session):
    configuration = await knowledge_session.get(KnowledgeCaptionConfigurationModel, 1)
    assert configuration is not None
    assert configuration.mode.value == "disabled"
    assert configuration.provider_model_id is None

    updated = await update_captioning_configuration(
        payload=KnowledgeCaptionConfigurationUpdate(mode="disabled"), session=knowledge_session
    )
    assert updated.mode == "disabled"
    assert (await get_captioning_configuration(session=knowledge_session)).updated_at == updated.updated_at


@pytest.mark.asyncio
async def test_knowledge_documents_capture_owned_immutable_file_metadata(knowledge_session):
    knowledge_base = await create_knowledge_base(
        user_id="user-a", payload=KnowledgeBaseCreate(name="Documents"), session=knowledge_session
    )
    file = UserFileModel(
        user_id="user-a",
        filename="source.txt",
        original_name="Source.txt",
        size=7,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="a" * 64,
        content_status=FileContentStatus.READY,
    )
    foreign_file = UserFileModel(
        user_id="user-b",
        filename="private.txt",
        original_name="Private.txt",
        size=7,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="b" * 64,
        content_status=FileContentStatus.READY,
    )
    knowledge_session.add_all([file, foreign_file])
    await knowledge_session.commit()

    document = await add_knowledge_document(
        user_id="user-a",
        knowledge_base_id=knowledge_base.id,
        payload=KnowledgeDocumentCreate(file_id=file.id, metadata={"category": "notes"}),
        session=knowledge_session,
    )
    assert document.original_name == "Source.txt"
    assert document.content_sha256 == "a" * 64
    assert document.status == "pending"
    assert document.caption.status is None
    assert document.caption.text is None
    assert document.metadata == {"category": "notes"}
    replacement_file = UserFileModel(
        user_id="user-a",
        filename="source-v2.txt",
        original_name="Source v2.txt",
        size=8,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="c" * 64,
        content_status=FileContentStatus.READY,
    )
    knowledge_session.add(replacement_file)
    await knowledge_session.commit()
    revision = await create_knowledge_document_revision(
        user_id="user-a",
        knowledge_base_id=knowledge_base.id,
        document_id=document.id,
        payload=KnowledgeDocumentRevisionCreate(file_id=replacement_file.id),
        session=knowledge_session,
    )
    assert revision.revision == 2
    assert revision.replaces_document_id == document.id
    assert revision.metadata == {"category": "notes"}
    assert revision.content_sha256 == "c" * 64

    listing = await list_knowledge_documents(
        user_id="user-a", knowledge_base_id=knowledge_base.id, session=knowledge_session, page=1, page_size=50
    )
    assert [item.id for item in listing.documents] == [document.id, revision.id]
    updated = await update_knowledge_document_metadata(
        user_id="user-a",
        knowledge_base_id=knowledge_base.id,
        document_id=document.id,
        payload=KnowledgeDocumentUpdate(metadata={"category": "reference"}),
        session=knowledge_session,
    )
    assert updated.metadata == {"category": "reference"}

    with pytest.raises(NotFoundException):
        await add_knowledge_document(
            user_id="user-a",
            knowledge_base_id=knowledge_base.id,
            payload=KnowledgeDocumentCreate(file_id=foreign_file.id),
            session=knowledge_session,
        )
    with pytest.raises(CodedException) as error:
        await add_knowledge_document(
            user_id="user-a",
            knowledge_base_id=knowledge_base.id,
            payload=KnowledgeDocumentCreate(file_id=file.id),
            session=knowledge_session,
        )
    assert error.value.code == 409
    with pytest.raises(NotFoundException):
        await get_knowledge_document(
            user_id="user-b", knowledge_base_id=knowledge_base.id, document_id=document.id, session=knowledge_session
        )

    deleted = await delete_knowledge_document(
        user_id="user-a", knowledge_base_id=knowledge_base.id, document_id=document.id, session=knowledge_session
    )
    assert deleted.id == document.id


@pytest.mark.asyncio
async def test_ingestion_indexes_text_idempotently_and_never_marks_partial_work_ready(
    knowledge_session, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "storage_root", tmp_path)
    knowledge_base = await create_knowledge_base(
        user_id="user-a", payload=KnowledgeBaseCreate(name="Indexed"), session=knowledge_session
    )
    file = UserFileModel(
        user_id="user-a",
        filename="index.txt",
        original_name="index.txt",
        size=11,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
        content_status=FileContentStatus.PENDING,
    )
    knowledge_session.add(file)
    await knowledge_session.commit()
    path = config.files_root / "user-a"
    path.mkdir(parents=True)
    (path / file.filename).write_text("hello world", encoding="utf-8")
    response = await add_knowledge_document(
        user_id="user-a",
        knowledge_base_id=knowledge_base.id,
        payload=KnowledgeDocumentCreate(file_id=file.id),
        session=knowledge_session,
    )
    document = await knowledge_session.get(KnowledgeDocumentModel, response.id)
    assert document is not None

    class FakeEmbeddings:
        dimension = 2

        async def initialize(self):
            pass

        async def embed_text(self, texts):
            return [[1.0, 0.0] for _ in texts]

        async def embed_image(self, images):
            return []

        async def close(self):
            pass

    class FakeVectors:
        def __init__(self):
            self.chunks = []

        async def initialize(self):
            pass

        async def add(self, chunks):
            self.chunks.extend(chunks)

        async def search(self, *args, **kwargs):
            return []

        async def delete_document(self, **kwargs):
            self.chunks.clear()

        async def delete_knowledge_base(self, **kwargs):
            self.chunks.clear()

        async def close(self):
            pass

    vectors = FakeVectors()
    indexed = await ingest_document(
        document=document,
        file=file,
        session=knowledge_session,
        embedding_provider=FakeEmbeddings(),
        vector_store=vectors,
    )
    assert indexed.status is KnowledgeDocumentStatus.READY
    assert len(vectors.chunks) == 1
    events = list(
        await knowledge_session.scalars(
            select(KnowledgeAuditEventModel).where(KnowledgeAuditEventModel.document_id == document.id)
        )
    )
    assert {event.action for event in events} >= {"document.indexing_started", "document.indexing_ready"}
    assert all("hello" not in str(event.details).lower() for event in events)
    # A ready immutable revision is a no-op rather than generating duplicate chunks.
    await ingest_document(
        document=indexed,
        file=file,
        session=knowledge_session,
        embedding_provider=FakeEmbeddings(),
        vector_store=vectors,
    )
    assert len(vectors.chunks) == 1


@pytest.mark.asyncio
async def test_caption_job_persists_bounded_draft_and_content_free_audit(knowledge_session, monkeypatch):
    knowledge_base = await create_knowledge_base(
        user_id="user-a", payload=KnowledgeBaseCreate(name="Images"), session=knowledge_session
    )
    file = UserFileModel(
        user_id="user-a",
        filename="diagram.png",
        original_name="Diagram.png",
        size=12,
        mime_type="image/png",
        kind=FileKind.IMAGE,
        sha256="d" * 64,
        content_status=FileContentStatus.READY,
    )
    knowledge_session.add(file)
    await knowledge_session.commit()
    document = await add_knowledge_document(
        user_id="user-a",
        knowledge_base_id=knowledge_base.id,
        payload=KnowledgeDocumentCreate(file_id=file.id),
        session=knowledge_session,
    )

    sessions = async_sessionmaker(knowledge_session.bind, expire_on_commit=False)

    @asynccontextmanager
    async def test_session():
        async with sessions() as session:
            yield session

    monkeypatch.setattr("asterism.domains.knowledge.caption_jobs.get_async_db_session", test_session)

    async def caption(*_):
        return CaptionResult(text="  A private diagram with  arrows.  ", source=CaptionMode.LOCAL, model="smolvlm2")

    jobs = KnowledgeCaptionJobs(caption)
    assert jobs.enqueue(user_id="user-a", knowledge_base_id=knowledge_base.id, document_id=document.id)
    assert not jobs.enqueue(user_id="user-a", knowledge_base_id=knowledge_base.id, document_id=document.id)
    await jobs._tasks[str(document.id)]

    persisted = await knowledge_session.get(KnowledgeDocumentModel, document.id)
    assert persisted.caption_status is KnowledgeCaptionStatus.DRAFT
    assert persisted.caption_text == "A private diagram with arrows."
    assert persisted.caption_source.value == "local"
    events = list(
        await knowledge_session.scalars(
            select(KnowledgeAuditEventModel).where(KnowledgeAuditEventModel.document_id == document.id)
        )
    )
    assert {event.action for event in events} >= {"caption.started", "caption.local_drafted"}
    assert all("private diagram" not in str(event.details).lower() for event in events)

    class FakeEmbeddings:
        async def embed_text(self, texts):
            assert texts == ["A reviewed diagram"]
            return [[0.1, 0.2]]

    class FakeVectors:
        def __init__(self):
            self.deleted = []
            self.added = []

        async def delete_chunk(self, **kwargs):
            self.deleted.append(kwargs)

        async def add(self, chunks):
            self.added.extend(chunks)

    vectors = FakeVectors()
    accepted = await update_knowledge_document_caption(
        user_id="user-a",
        knowledge_base_id=knowledge_base.id,
        document_id=document.id,
        payload=KnowledgeCaptionUpdate(text="A reviewed diagram", accept=True),
        session=knowledge_session,
        embedding_provider=FakeEmbeddings(),
        vector_store=vectors,
    )
    assert accepted.caption.status == "accepted"
    assert accepted.caption.text == "A reviewed diagram"
    assert len(vectors.deleted) == len(vectors.added) == 1
    assert vectors.added[0].content == "A reviewed diagram"
    assert vectors.added[0].id == vectors.deleted[0]["chunk_id"]
