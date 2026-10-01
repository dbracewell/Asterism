import asyncio
import uuid
from contextlib import asynccontextmanager

import pytest
import pytest_asyncio
from asterism.core import config
from asterism.core.exceptions import BadDataException, CodedException, NotFoundException
from asterism.db.base import Base
from asterism.domains.files.models import FileContentStatus, FileKind, UserFileModel
from asterism.domains.knowledge.caption_jobs import KnowledgeCaptionJobs
from asterism.domains.knowledge.embedding_download import EmbeddingBundleNotReadyError
from asterism.domains.knowledge.ingestion import ingest_file_artifact
from asterism.domains.knowledge.jobs import KnowledgeIngestionJobs
from asterism.domains.knowledge.models import FileKnowledgeArtifactStatus, KnowledgeBaseFileModel
from asterism.domains.knowledge.schemas import (
    KnowledgeBaseCreate,
    KnowledgeBaseFileCreate,
    KnowledgeBaseFileReorder,
    KnowledgeBaseUpdate,
    KnowledgeCaptionConfigurationUpdate,
    KnowledgeProcessingProfileUpdate,
)
from asterism.domains.knowledge.service import (
    add_knowledge_base_file,
    create_knowledge_base,
    delete_knowledge_base,
    get_captioning_configuration,
    get_knowledge_base,
    list_knowledge_base_files,
    list_knowledge_bases,
    remove_knowledge_base_file,
    reorder_knowledge_base_files,
    update_captioning_configuration,
    update_knowledge_base,
    update_processing_profile_and_reprocess,
)
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.user.models import UserModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def knowledge_session(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'knowledge-bases.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    class FakeVectorStore:
        async def delete_file(self, **_):
            pass

        async def delete_file_generation(self, **_):
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
async def test_file_memberships_are_owned_ordered_references(knowledge_session):
    base = await create_knowledge_base(
        user_id="user-a",
        payload=KnowledgeBaseCreate(name="References"),
        session=knowledge_session,
    )
    owned = UserFileModel(
        user_id="user-a",
        filename="first.txt",
        original_name="first.txt",
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="a" * 64,
    )
    second = UserFileModel(
        user_id="user-a",
        filename="second.txt",
        original_name="second.txt",
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="b" * 64,
    )
    foreign = UserFileModel(
        user_id="user-b",
        filename="private.txt",
        original_name="private.txt",
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="c" * 64,
    )
    knowledge_session.add_all([owned, second, foreign])
    await knowledge_session.commit()
    foreign_file_id = foreign.id

    first_membership = await add_knowledge_base_file(
        user_id="user-a",
        knowledge_base_id=base.id,
        payload=KnowledgeBaseFileCreate(file_id=owned.id),
        session=knowledge_session,
    )
    second_membership = await add_knowledge_base_file(
        user_id="user-a",
        knowledge_base_id=base.id,
        payload=KnowledgeBaseFileCreate(file_id=second.id),
        session=knowledge_session,
    )
    assert (first_membership.file_id, first_membership.position) == (owned.id, 1)
    assert (second_membership.file_id, second_membership.position) == (second.id, 2)
    listing = await list_knowledge_base_files(
        user_id="user-a",
        knowledge_base_id=base.id,
        session=knowledge_session,
        page=1,
        page_size=50,
    )
    assert [entry.file_id for entry in listing.files] == [owned.id, second.id]
    reordered = await reorder_knowledge_base_files(
        user_id="user-a",
        knowledge_base_id=base.id,
        payload=KnowledgeBaseFileReorder(membership_ids=[second_membership.id, first_membership.id]),
        session=knowledge_session,
    )
    assert [item.file_id for item in reordered.files] == [second.id, owned.id]
    await remove_knowledge_base_file(
        user_id="user-a",
        knowledge_base_id=base.id,
        membership_id=first_membership.id,
        session=knowledge_session,
    )
    assert await knowledge_session.get(UserFileModel, owned.id) is not None
    assert await knowledge_session.get(KnowledgeBaseFileModel, first_membership.id) is None
    reattached = await add_knowledge_base_file(
        user_id="user-a",
        knowledge_base_id=base.id,
        payload=KnowledgeBaseFileCreate(file_id=owned.id),
        session=knowledge_session,
    )
    assert reattached.file_id == owned.id
    with pytest.raises(NotFoundException, match="File not found"):
        await add_knowledge_base_file(
            user_id="user-a",
            knowledge_base_id=base.id,
            payload=KnowledgeBaseFileCreate(file_id=foreign_file_id),
            session=knowledge_session,
        )


@pytest.mark.asyncio
async def test_knowledge_base_crud_is_owner_scoped_and_paginated(knowledge_session):
    first = await create_knowledge_base(
        user_id="user-a",
        payload=KnowledgeBaseCreate(name="  Product   Notes ", description="  Private docs  "),
        session=knowledge_session,
    )
    second = await create_knowledge_base(
        user_id="user-a",
        payload=KnowledgeBaseCreate(name="Archive"),
        session=knowledge_session,
    )
    first.created_at = 1
    second.created_at = 2
    await knowledge_session.commit()
    await create_knowledge_base(
        user_id="user-b",
        payload=KnowledgeBaseCreate(name="Private"),
        session=knowledge_session,
    )

    assert first.name == "Product Notes"
    assert first.description == "Private docs"
    listing = await list_knowledge_bases(user_id="user-a", session=knowledge_session, page=1, page_size=1)
    assert listing.total == 2
    assert len(listing.knowledge_bases) == 1

    searched = await list_knowledge_bases(
        user_id="user-a",
        session=knowledge_session,
        page=1,
        page_size=50,
        query="product",
    )
    assert [base.id for base in searched.knowledge_bases] == [first.id]

    by_name = await list_knowledge_bases(
        user_id="user-a",
        session=knowledge_session,
        page=1,
        page_size=50,
        sort_by="name",
    )
    assert [base.name for base in by_name.knowledge_bases] == ["Archive", "Product Notes"]

    by_created = await list_knowledge_bases(
        user_id="user-a",
        session=knowledge_session,
        page=1,
        page_size=50,
        sort_by="created",
    )
    assert [base.name for base in by_created.knowledge_bases] == ["Archive", "Product Notes"]

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
            user_id="user-a",
            payload=KnowledgeBaseCreate(name="   "),
            session=knowledge_session,
        )
    await create_knowledge_base(
        user_id="user-a",
        payload=KnowledgeBaseCreate(name="Same name"),
        session=knowledge_session,
    )
    with pytest.raises(CodedException) as error:
        await create_knowledge_base(
            user_id="user-a",
            payload=KnowledgeBaseCreate(name="Same name"),
            session=knowledge_session,
        )
    assert error.value.code == 409


@pytest.mark.asyncio
async def test_caption_configuration_is_seeded_disabled(knowledge_session):
    configuration = await get_captioning_configuration(session=knowledge_session)
    assert configuration.mode == "disabled"
    assert configuration.provider_model_id is None
    assert await knowledge_session.get(ApplicationSettingsModel, "knowledge.processing") is None

    updated = await update_captioning_configuration(
        payload=KnowledgeCaptionConfigurationUpdate(mode="disabled"),
        session=knowledge_session,
    )
    assert updated.mode == "disabled"
    assert (await get_captioning_configuration(session=knowledge_session)).updated_at == updated.updated_at
    setting = await knowledge_session.get(ApplicationSettingsModel, "knowledge.processing")
    assert setting is not None
    assert setting.value["captioning"] == {"mode": "disabled", "provider_model_id": None}


@pytest.mark.asyncio
async def test_malformed_processing_setting_falls_back_and_is_healed_by_an_update(knowledge_session):
    knowledge_session.add(
        ApplicationSettingsModel(key="knowledge.processing", value={"schema_version": "not-a-version"}),
    )
    await knowledge_session.commit()

    default = await get_captioning_configuration(session=knowledge_session)
    assert default.mode == "disabled"
    assert default.provider_model_id is None

    result = await update_processing_profile_and_reprocess(
        payload=KnowledgeProcessingProfileUpdate(
            extraction_policy="extract-v2",
            chunking_policy="chunk-v2",
            embedding_model="embed-v2",
            captioning_policy="caption-v2",
        ),
        session=knowledge_session,
    )
    setting = await knowledge_session.get(ApplicationSettingsModel, "knowledge.processing")
    assert setting is not None
    assert setting.value["schema_version"] == 1
    assert setting.value["generation"] == 2
    assert setting.value["identity"] == result.profile.identity


@pytest.mark.asyncio
async def test_profile_change_queues_replacements_without_retiring_ready_generations(knowledge_session, monkeypatch):
    class FakeJobs:
        def __init__(self):
            self.enqueued: list[uuid.UUID] = []

        def enqueue(self, *, artifact_id, **_):
            self.enqueued.append(artifact_id)
            return True

    jobs = FakeJobs()
    monkeypatch.setattr("asterism.domains.knowledge.runtime.knowledge_ingestion_jobs", jobs)
    file = UserFileModel(
        user_id="user-a",
        filename="profile.txt",
        original_name="profile.txt",
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="d" * 64,
    )
    knowledge_session.add(file)
    await knowledge_session.flush()
    from asterism.domains.knowledge.models import FileKnowledgeArtifactModel

    ready = FileKnowledgeArtifactModel(
        user_id="user-a",
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        processing_profile_identity="a" * 64,
        status=FileKnowledgeArtifactStatus.READY,
        is_current=True,
    )
    knowledge_session.add(ready)
    await knowledge_session.commit()
    result = await update_processing_profile_and_reprocess(
        payload=KnowledgeProcessingProfileUpdate(
            extraction_policy="extract-v2",
            chunking_policy="chunk-v2",
            embedding_model="embed-v2",
            captioning_policy="caption-v2",
        ),
        session=knowledge_session,
    )
    artifacts = list(
        await knowledge_session.scalars(
            select(FileKnowledgeArtifactModel).where(FileKnowledgeArtifactModel.file_id == file.id),
        ),
    )
    assert result.queued_file_count == 1
    assert {(item.generation, item.status, item.is_current) for item in artifacts} == {
        (1, FileKnowledgeArtifactStatus.READY, True),
        (2, FileKnowledgeArtifactStatus.PENDING, False),
    }
    assert jobs.enqueued == [next(item.id for item in artifacts if item.generation == 2)]

    class FailingEmbeddings:
        async def embed_text(self, _):
            raise RuntimeError("provider unavailable")

        async def embed_image(self, _):
            raise RuntimeError("provider unavailable")

    class FakeVectors:
        async def delete_file_generation(self, **_):
            pass

        async def add(self, _):
            raise AssertionError("failed embeddings must not write vectors")

    replacement = next(item for item in artifacts if item.generation == 2)
    failed = await ingest_file_artifact(
        artifact=replacement,
        file=file,
        session=knowledge_session,
        embedding_provider=FailingEmbeddings(),
        vector_store=FakeVectors(),
    )
    assert failed.status is FileKnowledgeArtifactStatus.FAILED
    await knowledge_session.refresh(ready)
    assert ready.is_current


@pytest.mark.asyncio
async def test_captioning_policy_change_uses_the_same_generation_transition(knowledge_session, monkeypatch):
    class FakeJobs:
        def __init__(self):
            self.enqueued: list[uuid.UUID] = []

        def enqueue(self, *, artifact_id, **_):
            self.enqueued.append(artifact_id)
            return True

    jobs = FakeJobs()
    monkeypatch.setattr("asterism.domains.knowledge.runtime.knowledge_ingestion_jobs", jobs)
    file = UserFileModel(
        user_id="user-a",
        filename="caption-transition.png",
        original_name="caption-transition.png",
        size=1,
        mime_type="image/png",
        kind=FileKind.IMAGE,
        sha256="e" * 64,
    )
    knowledge_session.add(file)
    await knowledge_session.flush()
    from asterism.domains.knowledge.models import FileKnowledgeArtifactModel

    ready = FileKnowledgeArtifactModel(
        user_id=file.user_id,
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        processing_profile_identity="a" * 64,
        status=FileKnowledgeArtifactStatus.READY,
        is_current=True,
    )
    knowledge_session.add(ready)
    await knowledge_session.commit()

    updated = await update_captioning_configuration(
        payload=KnowledgeCaptionConfigurationUpdate(mode="local"),
        session=knowledge_session,
    )
    artifacts = list(
        await knowledge_session.scalars(
            select(FileKnowledgeArtifactModel).where(FileKnowledgeArtifactModel.file_id == file.id),
        ),
    )
    replacement = next(item for item in artifacts if item.generation == 2)
    assert updated.mode == "local"
    assert replacement.processing_profile_generation == 2
    assert replacement.is_current is False
    assert ready.is_current is True
    assert jobs.enqueued == [replacement.id]

    no_op = await update_captioning_configuration(
        payload=KnowledgeCaptionConfigurationUpdate(mode="local"),
        session=knowledge_session,
    )
    assert no_op.updated_at == updated.updated_at
    assert len(list(await knowledge_session.scalars(select(FileKnowledgeArtifactModel)))) == 2


@pytest.mark.asyncio
async def test_file_memberships_reuse_owned_file_metadata(knowledge_session):
    knowledge_base = await create_knowledge_base(
        user_id="user-a",
        payload=KnowledgeBaseCreate(name="Documents"),
        session=knowledge_session,
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

    membership = await add_knowledge_base_file(
        user_id="user-a",
        knowledge_base_id=knowledge_base.id,
        payload=KnowledgeBaseFileCreate(file_id=file.id),
        session=knowledge_session,
    )
    assert membership.file_id == file.id
    with pytest.raises(NotFoundException):
        await add_knowledge_base_file(
            user_id="user-a",
            knowledge_base_id=knowledge_base.id,
            payload=KnowledgeBaseFileCreate(file_id=foreign_file.id),
            session=knowledge_session,
        )


@pytest.mark.asyncio
async def test_ingestion_indexes_text_idempotently_and_never_marks_partial_work_ready(
    knowledge_session,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(config, "storage_root", tmp_path)
    await create_knowledge_base(
        user_id="user-a",
        payload=KnowledgeBaseCreate(name="Indexed"),
        session=knowledge_session,
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
    from asterism.domains.knowledge.service import ensure_file_knowledge_artifact

    artifact = await ensure_file_knowledge_artifact(file=file, session=knowledge_session)
    await knowledge_session.commit()

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

        async def delete_file_generation(self, **kwargs):
            self.chunks.clear()

        async def close(self):
            pass

    vectors = FakeVectors()
    indexed = await ingest_file_artifact(
        artifact=artifact,
        file=file,
        session=knowledge_session,
        embedding_provider=FakeEmbeddings(),
        vector_store=vectors,
    )
    assert indexed.status is FileKnowledgeArtifactStatus.READY
    assert len(vectors.chunks) == 1
    # A ready immutable revision is a no-op rather than generating duplicate chunks.
    await ingest_file_artifact(
        artifact=indexed,
        file=file,
        session=knowledge_session,
        embedding_provider=FakeEmbeddings(),
        vector_store=vectors,
    )
    assert len(vectors.chunks) == 1


@pytest.mark.asyncio
async def test_caption_job_cancel_signals_the_single_queued_revision(monkeypatch):
    started = asyncio.Event()

    async def blocked_run(**_):
        started.set()
        await asyncio.Event().wait()

    jobs = KnowledgeCaptionJobs(lambda *_: None)  # type: ignore[arg-type]
    monkeypatch.setattr(jobs, "_run", blocked_run)
    artifact_id = uuid.uuid4()
    file_id = uuid.uuid4()
    assert jobs.enqueue(user_id="user-a", file_id=file_id, artifact_id=artifact_id)
    await started.wait()
    assert jobs.cancel(str(artifact_id))
    with pytest.raises(asyncio.CancelledError):
        await jobs._tasks[str(artifact_id)]
    await asyncio.sleep(0)
    assert not jobs.cancel(str(artifact_id))


@pytest.mark.asyncio
async def test_restart_recovery_makes_processing_artifact_retryable(knowledge_session, monkeypatch):
    file = UserFileModel(
        user_id="user-a",
        filename="restart.txt",
        original_name="restart.txt",
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="e" * 64,
    )
    knowledge_session.add(file)
    await knowledge_session.flush()
    from asterism.domains.knowledge.models import FileKnowledgeArtifactModel

    artifact = FileKnowledgeArtifactModel(
        user_id="user-a",
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        processing_profile_identity="a" * 64,
        status=FileKnowledgeArtifactStatus.PROCESSING,
    )
    knowledge_session.add(artifact)
    await knowledge_session.commit()

    @asynccontextmanager
    async def session_factory():
        yield knowledge_session

    monkeypatch.setattr("asterism.domains.knowledge.jobs.get_async_db_session", session_factory)
    await KnowledgeIngestionJobs(max_concurrency=1).recover_interrupted()
    await knowledge_session.refresh(artifact)
    assert artifact.status is FileKnowledgeArtifactStatus.PENDING
    assert artifact.error_code == "interrupted"


@pytest.mark.asyncio
async def test_embedding_provisioning_wait_leaves_artifact_pending(knowledge_session, monkeypatch):
    file = UserFileModel(
        user_id="user-a",
        filename="waiting.txt",
        original_name="waiting.txt",
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="f" * 64,
        content_status=FileContentStatus.READY,
        content_cache="queued until the embedding bundle is ready",
    )
    knowledge_session.add(file)
    await knowledge_session.flush()
    from asterism.domains.knowledge.models import FileKnowledgeArtifactModel

    artifact = FileKnowledgeArtifactModel(
        user_id="user-a",
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        processing_profile_identity="b" * 64,
        status=FileKnowledgeArtifactStatus.PENDING,
    )
    knowledge_session.add(artifact)
    await knowledge_session.commit()

    async def already_processed(*, file, session):
        return file

    monkeypatch.setattr("asterism.domains.knowledge.ingestion.ensure_file_processed", already_processed)

    class WaitingEmbeddings:
        async def embed_text(self, _):
            raise EmbeddingBundleNotReadyError("provisioning")

        async def embed_image(self, _):
            raise EmbeddingBundleNotReadyError("provisioning")

    class Vectors:
        async def delete_file_generation(self, **_):
            raise AssertionError("no vectors exist while provisioning")

        async def add(self, _):
            raise AssertionError("no vectors are added while provisioning")

    result = await ingest_file_artifact(
        artifact=artifact,
        file=file,
        session=knowledge_session,
        embedding_provider=WaitingEmbeddings(),
        vector_store=Vectors(),
    )
    assert result.status is FileKnowledgeArtifactStatus.PENDING
    assert result.error_code == "embedding_bundle_pending"
