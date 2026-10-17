import uuid
from contextlib import asynccontextmanager

import pytest
import pytest_asyncio
from asterism.core import config
from asterism.db.base import Base
from asterism.domains.extraction.ingestion import ingest_file
from asterism.domains.extraction.model_download import DownloadNotReadyError
from asterism.domains.extraction.models import FileKnowledgeArtifactStatus
from asterism.domains.extraction.runtime import recover_interrupted
from asterism.domains.files.models import FileContentStatus, FileKind, UserFileModel
from asterism.domains.files.processing import update_captioning_configuration, update_processing_profile_and_reprocess
from asterism.domains.files.processing_schemas import (
    KnowledgeCaptionConfigurationUpdate,
    KnowledgeProcessingProfileUpdate,
)
from asterism.domains.settings.knowledge import get_captioning_configuration
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.user.models import UserModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def processing_session(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'processing.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    class FakeVectorStore:
        async def delete_file(self, **_):
            pass

        async def delete_file_generation(self, **_):
            pass

    monkeypatch.setattr("asterism.domains.extraction.runtime.vector_store", FakeVectorStore())
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all([UserModel(id="user-a"), UserModel(id="user-b")])
        await session.commit()
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_caption_configuration_is_seeded_disabled(processing_session):
    configuration = await get_captioning_configuration(session=processing_session)
    assert configuration.mode == "disabled"
    assert configuration.provider_model_id is None
    assert await processing_session.get(ApplicationSettingsModel, "knowledge.processing") is None

    updated = await update_captioning_configuration(
        payload=KnowledgeCaptionConfigurationUpdate(mode="disabled"),
        session=processing_session,
    )
    assert updated.mode == "disabled"
    assert (await get_captioning_configuration(session=processing_session)).updated_at == updated.updated_at
    setting = await processing_session.get(ApplicationSettingsModel, "knowledge.processing")
    assert setting is not None
    assert setting.value["captioning"] == {"mode": "disabled", "provider_model_id": None}


@pytest.mark.asyncio
async def test_malformed_processing_setting_falls_back_and_is_healed_by_an_update(processing_session):
    processing_session.add(
        ApplicationSettingsModel(key="knowledge.processing", value={"schema_version": "not-a-version"}),
    )
    await processing_session.commit()

    default = await get_captioning_configuration(session=processing_session)
    assert default.mode == "disabled"
    assert default.provider_model_id is None

    result = await update_processing_profile_and_reprocess(
        payload=KnowledgeProcessingProfileUpdate(
            extraction_policy="extract-v2",
            chunking_policy="chunk-v2",
            embedding_model="embed-v2",
            captioning_policy="caption-v2",
        ),
        session=processing_session,
    )
    setting = await processing_session.get(ApplicationSettingsModel, "knowledge.processing")
    assert setting is not None
    assert setting.value["schema_version"] == 1
    assert setting.value["generation"] == 2
    assert setting.value["identity"] == result.profile.identity


@pytest.mark.asyncio
async def test_profile_change_queues_replacements_without_retiring_ready_generations(processing_session, monkeypatch):
    class FakeJobs:
        def __init__(self):
            self.enqueued: list[uuid.UUID] = []

        def enqueue(self, *, artifact_id, **_):
            self.enqueued.append(artifact_id)
            return True

    jobs = FakeJobs()
    monkeypatch.setattr(
        "asterism.domains.files.processing.start_file_ingestion_job",
        lambda **kwargs: jobs.enqueue(**kwargs),
    )
    file = UserFileModel(
        storage_key=str(uuid.uuid4()),
        user_id="user-a",
        filename="profile.txt",
        original_name="profile.txt",
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="d" * 64,
    )
    processing_session.add(file)
    await processing_session.flush()
    from asterism.domains.extraction.models import FileExtractionModel

    ready = FileExtractionModel(
        user_id="user-a",
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        processing_profile_identity="a" * 64,
        status=FileKnowledgeArtifactStatus.READY,
        is_current=True,
    )
    processing_session.add(ready)
    await processing_session.commit()
    result = await update_processing_profile_and_reprocess(
        payload=KnowledgeProcessingProfileUpdate(
            extraction_policy="extract-v2",
            chunking_policy="chunk-v2",
            embedding_model="embed-v2",
            captioning_policy="caption-v2",
        ),
        session=processing_session,
    )
    artifacts = list(
        await processing_session.scalars(
            select(FileExtractionModel).where(FileExtractionModel.file_id == file.id),
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
    failed = await ingest_file(
        extraction=replacement,
        file=file,
        session=processing_session,
        provider=FailingEmbeddings(),
        store=FakeVectors(),
    )
    assert failed.status is FileKnowledgeArtifactStatus.FAILED
    await processing_session.refresh(ready)
    assert ready.is_current


@pytest.mark.asyncio
async def test_captioning_policy_change_uses_the_same_generation_transition(processing_session, monkeypatch):
    class FakeJobs:
        def __init__(self):
            self.enqueued: list[uuid.UUID] = []

        def enqueue(self, *, artifact_id, **_):
            self.enqueued.append(artifact_id)
            return True

    jobs = FakeJobs()
    monkeypatch.setattr(
        "asterism.domains.files.processing.start_file_ingestion_job",
        lambda **kwargs: jobs.enqueue(**kwargs),
    )
    file = UserFileModel(
        storage_key=str(uuid.uuid4()),
        user_id="user-a",
        filename="caption-transition.png",
        original_name="caption-transition.png",
        size=1,
        mime_type="image/png",
        kind=FileKind.IMAGE,
        sha256="e" * 64,
    )
    processing_session.add(file)
    await processing_session.flush()
    from asterism.domains.extraction.models import FileExtractionModel

    ready = FileExtractionModel(
        user_id=file.user_id,
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        processing_profile_identity="a" * 64,
        status=FileKnowledgeArtifactStatus.READY,
        is_current=True,
    )
    processing_session.add(ready)
    await processing_session.commit()

    updated = await update_captioning_configuration(
        payload=KnowledgeCaptionConfigurationUpdate(mode="local"),
        session=processing_session,
    )
    artifacts = list(
        await processing_session.scalars(
            select(FileExtractionModel).where(FileExtractionModel.file_id == file.id),
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
        session=processing_session,
    )
    assert no_op.updated_at == updated.updated_at
    assert len(list(await processing_session.scalars(select(FileExtractionModel)))) == 2


@pytest.mark.asyncio
async def test_ingestion_indexes_text_idempotently_and_never_marks_partial_work_ready(
    processing_session,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(config, "storage_root", tmp_path)
    file = UserFileModel(
        storage_key=str(uuid.uuid4()),
        user_id="user-a",
        filename="index.txt",
        original_name="index.txt",
        size=11,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
        content_status=FileContentStatus.PENDING,
    )
    processing_session.add(file)
    await processing_session.commit()
    from asterism.domains.files.store import get_file_store

    file.storage_key = get_file_store().save("user-a", file.id, ".txt", b"hello world")
    await processing_session.commit()
    from asterism.domains.files.processing import ensure_file_knowledge_artifact

    artifact = await ensure_file_knowledge_artifact(file=file, session=processing_session)
    await processing_session.commit()

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
    indexed = await ingest_file(
        extraction=artifact,
        file=file,
        session=processing_session,
        provider=FakeEmbeddings(),
        store=vectors,
    )
    assert indexed.status is FileKnowledgeArtifactStatus.READY
    assert len(vectors.chunks) == 1
    # A ready immutable revision is a no-op rather than generating duplicate chunks.
    await ingest_file(
        extraction=indexed,
        file=file,
        session=processing_session,
        provider=FakeEmbeddings(),
        store=vectors,
    )
    assert len(vectors.chunks) == 1


@pytest.mark.asyncio
@pytest.mark.asyncio
async def test_restart_recovery_makes_processing_artifact_retryable(processing_session, monkeypatch):
    file = UserFileModel(
        storage_key=str(uuid.uuid4()),
        user_id="user-a",
        filename="restart.txt",
        original_name="restart.txt",
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="e" * 64,
    )
    processing_session.add(file)
    await processing_session.flush()
    from asterism.domains.extraction.models import FileExtractionModel

    artifact = FileExtractionModel(
        user_id="user-a",
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        processing_profile_identity="a" * 64,
        status=FileKnowledgeArtifactStatus.PROCESSING,
    )
    processing_session.add(artifact)
    await processing_session.commit()

    @asynccontextmanager
    async def session_factory():
        yield processing_session

    monkeypatch.setattr("asterism.domains.extraction.runtime.get_async_db_session", session_factory)
    await recover_interrupted()
    await processing_session.refresh(artifact)
    assert artifact.status is FileKnowledgeArtifactStatus.PENDING
    assert artifact.error_code == "interrupted"


@pytest.mark.asyncio
async def test_embedding_provisioning_wait_leaves_artifact_pending(processing_session, monkeypatch):
    file = UserFileModel(
        storage_key=str(uuid.uuid4()),
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
    processing_session.add(file)
    await processing_session.flush()
    from asterism.domains.extraction.models import FileExtractionModel

    artifact = FileExtractionModel(
        user_id="user-a",
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        processing_profile_identity="b" * 64,
        status=FileKnowledgeArtifactStatus.PENDING,
    )
    processing_session.add(artifact)
    await processing_session.commit()

    async def already_processed(*, file, session):
        return file

    monkeypatch.setattr("asterism.domains.extraction.ingestion.ensure_file_processed", already_processed)

    class WaitingEmbeddings:
        async def embed_text(self, _):
            raise DownloadNotReadyError("provisioning")

        async def embed_image(self, _):
            raise DownloadNotReadyError("provisioning")

    class Vectors:
        async def delete_file_generation(self, **_):
            raise AssertionError("no vectors exist while provisioning")

        async def add(self, _):
            raise AssertionError("no vectors are added while provisioning")

    result = await ingest_file(
        extraction=artifact,
        file=file,
        session=processing_session,
        provider=WaitingEmbeddings(),
        store=Vectors(),
    )
    assert result.status is FileKnowledgeArtifactStatus.PENDING
    assert result.error_code == "embedding_bundle_pending"
