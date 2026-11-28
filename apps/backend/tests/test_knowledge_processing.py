import uuid
from contextlib import asynccontextmanager

import pytest
import pytest_asyncio
from asterism.core import config
from asterism.db.model_registry import Base
from asterism.domains.files.models import FileContentStatus, FileKind, UserFileModel
from asterism.domains.knowledge.embedding import EMBEDDING_MODEL_KEY
from asterism.domains.knowledge.ingestion import ingest_file
from asterism.domains.knowledge.model_download import DownloadNotReadyError
from asterism.domains.knowledge.models import KnowledgeExtractionStatus
from asterism.domains.knowledge.policy import get_captioning_configuration
from asterism.domains.knowledge.processing import (
    update_captioning_configuration,
    update_processing_profile_and_reprocess,
)
from asterism.domains.knowledge.processing_schemas import (
    KnowledgeCaptionConfigurationUpdate,
    KnowledgeProcessingProfileUpdate,
)
from asterism.domains.knowledge.runtime import recover_interrupted
from asterism.domains.knowledge.sources import SourceUnavailableError
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.user.models import UserModel
from knowledge_doubles import FakeSourceReader
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

    monkeypatch.setattr("asterism.domains.knowledge.runtime.vector_store", FakeVectorStore())
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
            embedding_model=EMBEDDING_MODEL_KEY,
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
async def test_a_source_that_cannot_be_read_fails_the_artifact(processing_session):
    """A conversion failure fails the artifact instead of leaving it pending.

    The source is read inside the ingestion's guarded section, so a file that
    cannot be converted is a failure of the generation rather than work that
    silently never finishes.
    """
    file = UserFileModel(
        storage_key=str(uuid.uuid4()),
        user_id="user-a",
        filename="unreadable.txt",
        original_name="unreadable.txt",
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="c" * 64,
    )
    processing_session.add(file)
    await processing_session.flush()
    from asterism.domains.knowledge.models import FileKnowledgeArtifactModel

    artifact = FileKnowledgeArtifactModel(
        id=uuid.uuid4(),
        user_id="user-a",
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        status=KnowledgeExtractionStatus.PENDING,
    )
    processing_session.add(artifact)
    await processing_session.commit()

    class UnreadableSource:
        async def read_source(self, *, file_id, user_id, session):
            raise SourceUnavailableError("The file could not be processed")

    class FakeVectors:
        async def delete_file_generation(self, **_):
            pass

        async def add(self, _):
            raise AssertionError("a failed source must not write vectors")

    result = await ingest_file(
        artifact=artifact,
        reader=UnreadableSource(),
        session=processing_session,
        store=FakeVectors(),
    )

    assert result.status is KnowledgeExtractionStatus.FAILED
    assert result.error_code == "processing_failed"


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
        "asterism.domains.knowledge.processing.start_file_ingestion_job",
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
    from asterism.domains.knowledge.models import FileKnowledgeArtifactModel

    ready = FileKnowledgeArtifactModel(
        user_id="user-a",
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        status=KnowledgeExtractionStatus.READY,
        is_current=True,
    )
    processing_session.add(ready)
    await processing_session.commit()
    result = await update_processing_profile_and_reprocess(
        payload=KnowledgeProcessingProfileUpdate(
            extraction_policy="extract-v2",
            chunking_policy="chunk-v2",
            embedding_model=EMBEDDING_MODEL_KEY,
            captioning_policy="caption-v2",
        ),
        session=processing_session,
    )
    artifacts = list(
        await processing_session.scalars(
            select(FileKnowledgeArtifactModel).where(FileKnowledgeArtifactModel.file_id == file.id),
        ),
    )
    assert result.queued_file_count == 1
    assert {(item.generation, item.status, item.is_current) for item in artifacts} == {
        (1, KnowledgeExtractionStatus.READY, True),
        (2, KnowledgeExtractionStatus.PENDING, False),
    }
    assert jobs.enqueued == [next(item.id for item in artifacts if item.generation == 2)]

    class FailingEmbeddings:
        async def embed_text(self, _):
            raise RuntimeError("provider unavailable")

        embed_query = embed_passage = embed_text

        async def embed_image(self, _):
            raise RuntimeError("provider unavailable")

    class FakeVectors:
        async def delete_file_generation(self, **_):
            pass

        async def add(self, _):
            raise AssertionError("failed embeddings must not write vectors")

    replacement = next(item for item in artifacts if item.generation == 2)
    failed = await ingest_file(
        artifact=replacement,
        reader=FakeSourceReader(),
        session=processing_session,
        provider=FailingEmbeddings(),
        store=FakeVectors(),
    )
    assert failed.status is KnowledgeExtractionStatus.FAILED
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
        "asterism.domains.knowledge.processing.start_file_ingestion_job",
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
    from asterism.domains.knowledge.models import FileKnowledgeArtifactModel

    ready = FileKnowledgeArtifactModel(
        user_id=file.user_id,
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        status=KnowledgeExtractionStatus.READY,
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
        session=processing_session,
    )
    assert no_op.updated_at == updated.updated_at
    assert len(list(await processing_session.scalars(select(FileKnowledgeArtifactModel)))) == 2


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
    from asterism.domains.knowledge.processing import ensure_file_knowledge_artifact

    artifact = await ensure_file_knowledge_artifact(
        file_id=file.id,
        user_id=file.user_id,
        session=processing_session,
    )
    await processing_session.commit()

    class FakeEmbeddings:
        dimension = 2

        async def initialize(self):
            pass

        async def embed_text(self, texts):
            return [[1.0, 0.0] for _ in texts]

        embed_query = embed_passage = embed_text

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
        artifact=artifact,
        reader=FakeSourceReader(),
        session=processing_session,
        provider=FakeEmbeddings(),
        store=vectors,
    )
    assert indexed.status is KnowledgeExtractionStatus.READY
    assert len(vectors.chunks) == 1
    # A ready immutable revision is a no-op rather than generating duplicate chunks.
    await ingest_file(
        artifact=indexed,
        reader=FakeSourceReader(),
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
    from asterism.domains.knowledge.models import FileKnowledgeArtifactModel

    artifact = FileKnowledgeArtifactModel(
        user_id="user-a",
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        status=KnowledgeExtractionStatus.RUNNING,
    )
    processing_session.add(artifact)
    await processing_session.commit()

    @asynccontextmanager
    async def session_factory():
        yield processing_session

    monkeypatch.setattr("asterism.domains.knowledge.runtime.get_async_db_session", session_factory)
    await recover_interrupted()
    await processing_session.refresh(artifact)
    assert artifact.status is KnowledgeExtractionStatus.PENDING
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
    from asterism.domains.knowledge.models import FileKnowledgeArtifactModel

    artifact = FileKnowledgeArtifactModel(
        user_id="user-a",
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        status=KnowledgeExtractionStatus.PENDING,
    )
    processing_session.add(artifact)
    await processing_session.commit()

    class WaitingEmbeddings:
        async def embed_text(self, _):
            raise DownloadNotReadyError("provisioning")

        embed_query = embed_passage = embed_text

        async def embed_image(self, _):
            raise DownloadNotReadyError("provisioning")

    class Vectors:
        async def delete_file_generation(self, **_):
            raise AssertionError("no vectors exist while provisioning")

        async def add(self, _):
            raise AssertionError("no vectors are added while provisioning")

    result = await ingest_file(
        artifact=artifact,
        reader=FakeSourceReader(),
        session=processing_session,
        provider=WaitingEmbeddings(),
        store=Vectors(),
    )
    assert result.status is KnowledgeExtractionStatus.PENDING
    assert result.error_code == "embedding_bundle_pending"


async def _captioning_case(session, *, name, captioning_status, error_code=None, searchable=False, is_current=True):
    from asterism.domains.knowledge.models import (
        FileKnowledgeArtifactModel,
        FileKnowledgeExtractionModel,
        KnowledgeExtractionKind,
    )

    file = UserFileModel(
        storage_key=str(uuid.uuid4()),
        user_id="user-a",
        filename=f"{name}.png",
        original_name=f"{name}.png",
        size=1,
        mime_type="image/png",
        kind=FileKind.IMAGE,
        sha256=uuid.uuid4().hex * 2,
    )
    session.add(file)
    await session.flush()
    artifact = FileKnowledgeArtifactModel(
        user_id="user-a",
        file_id=file.id,
        generation=1,
        processing_profile_generation=1,
        status=KnowledgeExtractionStatus.READY,
        is_current=is_current,
        searchable=searchable,
    )
    session.add(artifact)
    await session.flush()
    session.add(
        FileKnowledgeExtractionModel(
            artifact_id=artifact.id,
            kind=KnowledgeExtractionKind.CAPTIONING,
            status=captioning_status,
            error_code=error_code,
        ),
    )
    await session.commit()
    return artifact


@pytest_asyncio.fixture
async def resume_runtime(processing_session, monkeypatch):
    """Route the runtime to the test session, a fresh job manager and a blocking caption job."""
    import asyncio
    from types import SimpleNamespace

    from asterism.common.job_queue import JobManager
    from asterism.domains.knowledge import runtime

    @asynccontextmanager
    async def session_factory():
        yield processing_session

    captioned: list[uuid.UUID] = []
    release = asyncio.Event()

    async def blocking_caption(*, user_id, file_id, artifact_id):
        captioned.append(artifact_id)
        await release.wait()

    state = SimpleNamespace(mode="local", captioned=captioned)

    async def captioning_configuration(*, session):
        return SimpleNamespace(mode=state.mode)

    jobs = JobManager(max_concurrency=4)
    monkeypatch.setattr(runtime, "get_async_db_session", session_factory)
    monkeypatch.setattr(runtime, "job_manager", jobs)
    monkeypatch.setattr(runtime, "caption", blocking_caption)
    monkeypatch.setattr(runtime, "get_captioning_configuration", captioning_configuration)
    yield state
    release.set()
    await jobs.shutdown()


@pytest.mark.asyncio
async def test_resume_requeues_interrupted_and_pending_captioning_once(processing_session, resume_runtime):
    import asyncio

    from asterism.domains.knowledge.models import KnowledgeExtractionKind
    from asterism.domains.knowledge.runtime import resume_ingestion_jobs

    interrupted = await _captioning_case(
        processing_session, name="interrupted", captioning_status=KnowledgeExtractionStatus.RUNNING
    )
    pending = await _captioning_case(
        processing_session, name="pending", captioning_status=KnowledgeExtractionStatus.PENDING
    )
    broken = await _captioning_case(
        processing_session,
        name="broken",
        captioning_status=KnowledgeExtractionStatus.FAILED,
        error_code="provider_failure",
    )
    await _captioning_case(
        processing_session,
        name="captioned",
        captioning_status=KnowledgeExtractionStatus.READY,
        searchable=True,
    )
    await _captioning_case(
        processing_session,
        name="superseded",
        captioning_status=KnowledgeExtractionStatus.PENDING,
        is_current=False,
    )

    await recover_interrupted()
    from asterism.domains.knowledge.models import FileKnowledgeExtractionModel

    recovered = await processing_session.scalar(
        select(FileKnowledgeExtractionModel).where(
            FileKnowledgeExtractionModel.artifact_id == interrupted.id,
            FileKnowledgeExtractionModel.kind == KnowledgeExtractionKind.CAPTIONING,
        ),
    )
    assert recovered is not None
    assert recovered.status is KnowledgeExtractionStatus.FAILED
    assert recovered.error_code == "interrupted"

    await resume_ingestion_jobs()
    await asyncio.sleep(0.05)
    assert sorted(resume_runtime.captioned) == sorted([interrupted.id, pending.id])
    assert broken.id not in resume_runtime.captioned

    # The caption jobs are still running, so a second resume adds nothing.
    await resume_ingestion_jobs()
    await asyncio.sleep(0.05)
    assert len(resume_runtime.captioned) == 2


@pytest.mark.asyncio
async def test_resume_leaves_captioning_alone_when_disabled(processing_session, resume_runtime):
    import asyncio

    from asterism.domains.knowledge.runtime import resume_ingestion_jobs

    resume_runtime.mode = "disabled"
    await _captioning_case(processing_session, name="pending", captioning_status=KnowledgeExtractionStatus.PENDING)

    await resume_ingestion_jobs()
    await asyncio.sleep(0.05)
    assert resume_runtime.captioned == []


class FakeCaptionDownload:
    def __init__(self, *, ready: bool) -> None:
        self.bundle_ready = ready
        self.started = 0
        self.on_bundle_ready = None

    async def ready(self) -> bool:
        return self.bundle_ready

    async def start_download(self) -> None:
        self.started += 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("mode", "ready", "expected"), [("local", False, 1), ("local", True, 0), ("disabled", False, 0)]
)
async def test_startup_downloads_the_caption_bundle_only_for_local_captioning_without_one(
    resume_runtime, monkeypatch, mode, ready, expected
):
    from asterism.domains.knowledge import runtime

    download = FakeCaptionDownload(ready=ready)
    monkeypatch.setattr(runtime, "captioning_download_service", download)
    resume_runtime.mode = mode

    await runtime._provision_local_caption_model()

    assert download.started == expected


@pytest.mark.asyncio
async def test_a_verified_caption_bundle_resumes_captions_left_pending(processing_session, resume_runtime, monkeypatch):
    import asyncio

    from asterism.domains.knowledge import runtime

    download = FakeCaptionDownload(ready=False)
    monkeypatch.setattr(runtime, "captioning_download_service", download)
    monkeypatch.setattr(runtime.vector_store, "initialize", lambda: asyncio.sleep(0), raising=False)
    monkeypatch.setattr(runtime.config, "skip_knowledge_model_provisioning", True)
    pending = await _captioning_case(
        processing_session, name="pending", captioning_status=KnowledgeExtractionStatus.PENDING
    )

    await runtime.initialize_knowledge_runtime(FakeSourceReader(is_image=True))
    assert resume_runtime.captioned == []

    assert download.on_bundle_ready is not None
    await download.on_bundle_ready("bundle-sha256")
    await asyncio.sleep(0.05)
    assert resume_runtime.captioned == [pending.id]


@pytest.mark.asyncio
async def test_a_profile_edit_cannot_name_another_embedding_model(processing_session):
    """ADR-0079: the code's model is the only one that can embed."""
    from asterism.core.exceptions import BadDataException

    with pytest.raises(BadDataException, match=EMBEDDING_MODEL_KEY):
        await update_processing_profile_and_reprocess(
            payload=KnowledgeProcessingProfileUpdate(
                extraction_policy="extract-v2",
                chunking_policy="chunk-v2",
                embedding_model="another-model",
                captioning_policy="caption-v2",
            ),
            session=processing_session,
        )
