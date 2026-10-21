"""Lifecycle of knowledge-artifact generations: retention, index portability, reporting.

These cover the three invariants that keep the generation mechanism bounded
and consistent:

- superseded generations (and their vectors) are pruned to a retention window;
- the "one current generation per file" invariant is enforced by the database
  on every supported dialect;
- the artifact reported to the UI is the one retrieval actually serves.
"""

import uuid

import pytest
import pytest_asyncio
from asterism.core import config
from asterism.db.model_registry import Base
from asterism.domains.files.listing import describe_files
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel, KnowledgeExtractionStatus
from asterism.domains.knowledge.retention import generations_to_prune, prune_superseded_generations
from asterism.domains.user.models import UserModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


class RecordingVectorStore:
    """Vector store double that records per-generation deletions."""

    def __init__(self) -> None:
        self.deleted: list[tuple[str, str, int]] = []
        self.failures: set[int] = set()
        self.added: list[object] = []

    async def add(self, chunks) -> None:
        self.added.extend(chunks)

    async def delete_file_generation(self, *, user_id: str, file_id: str, artifact_generation: int) -> None:
        if artifact_generation in self.failures:
            raise RuntimeError("vector store unavailable")
        self.deleted.append((user_id, file_id, artifact_generation))


@pytest_asyncio.fixture
async def lifecycle_session(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'lifecycle.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all([UserModel(id="user-a"), UserModel(id="user-b")])
        await session.commit()
        yield session
    await engine.dispose()


def _artifact(
    *,
    file_id: uuid.UUID,
    generation: int,
    status: KnowledgeExtractionStatus,
    is_current: bool,
    user_id: str = "user-a",
) -> FileKnowledgeArtifactModel:
    return FileKnowledgeArtifactModel(
        user_id=user_id,
        file_id=file_id,
        generation=generation,
        processing_profile_generation=generation,
        processing_profile_identity="a" * 64,
        status=status,
        is_current=is_current,
    )


def _file(session, *, name: str = "report.txt") -> UserFileModel:
    model = UserFileModel(
        storage_key=str(uuid.uuid4()),
        user_id="user-a",
        filename=name,
        original_name=name,
        size=1,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="c" * 64,
    )
    session.add(model)
    return model


# --------------------------------------------------------------------------
# Retention rule
# --------------------------------------------------------------------------


def test_retention_rule_keeps_current_plus_window():
    generations = [
        (1, False, KnowledgeExtractionStatus.READY),
        (2, False, KnowledgeExtractionStatus.READY),
        (3, False, KnowledgeExtractionStatus.READY),
        (4, True, KnowledgeExtractionStatus.READY),
    ]
    assert generations_to_prune(generations, keep_previous=1) == [1, 2]
    assert generations_to_prune(generations, keep_previous=2) == [1]
    assert generations_to_prune(generations, keep_previous=3) == []
    assert generations_to_prune(generations, keep_previous=0) == [1, 2, 3]


def test_retention_rule_never_prunes_in_flight_work():
    generations = [
        (1, False, KnowledgeExtractionStatus.READY),
        (2, False, KnowledgeExtractionStatus.RUNNING),
        (3, False, KnowledgeExtractionStatus.PENDING),
        (4, True, KnowledgeExtractionStatus.READY),
    ]
    # Generations 2 and 3 are still running, so they survive a zero window.
    assert generations_to_prune(generations, keep_previous=0) == [1]
    assert generations_to_prune(generations, keep_previous=1) == [1]


def test_retention_rule_ignores_files_without_superseded_generations():
    assert generations_to_prune([(1, True, KnowledgeExtractionStatus.READY)], keep_previous=1) == []


# --------------------------------------------------------------------------
# Retention execution
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prune_removes_superseded_rows_and_their_vectors(lifecycle_session):
    file = _file(lifecycle_session)
    await lifecycle_session.flush()
    for generation, status, is_current in (
        (1, KnowledgeExtractionStatus.READY, False),
        (2, KnowledgeExtractionStatus.READY, False),
        (3, KnowledgeExtractionStatus.READY, True),
    ):
        lifecycle_session.add(
            _artifact(file_id=file.id, generation=generation, status=status, is_current=is_current),
        )
    await lifecycle_session.commit()

    store = RecordingVectorStore()
    removed = await prune_superseded_generations(
        user_id="user-a",
        file_id=file.id,
        session=lifecycle_session,
        keep_previous=1,
        store=store,
    )

    assert removed == 1
    assert store.deleted == [("user-a", str(file.id), 1)]
    remaining = list(
        await lifecycle_session.scalars(
            select(FileKnowledgeArtifactModel.generation).where(FileKnowledgeArtifactModel.file_id == file.id),
        ),
    )
    assert sorted(remaining) == [2, 3]


@pytest.mark.asyncio
async def test_prune_keeps_the_current_generation_and_in_flight_work(lifecycle_session):
    file = _file(lifecycle_session)
    await lifecycle_session.flush()
    for generation, status, is_current in (
        (1, KnowledgeExtractionStatus.READY, False),
        (2, KnowledgeExtractionStatus.PENDING, False),
        (3, KnowledgeExtractionStatus.READY, True),
    ):
        lifecycle_session.add(
            _artifact(file_id=file.id, generation=generation, status=status, is_current=is_current),
        )
    await lifecycle_session.commit()

    store = RecordingVectorStore()
    removed = await prune_superseded_generations(
        user_id="user-a",
        file_id=file.id,
        session=lifecycle_session,
        keep_previous=0,
        store=store,
    )

    assert removed == 1
    assert store.deleted == [("user-a", str(file.id), 1)]
    remaining = sorted(
        await lifecycle_session.scalars(
            select(FileKnowledgeArtifactModel.generation).where(FileKnowledgeArtifactModel.file_id == file.id),
        ),
    )
    assert remaining == [2, 3]


@pytest.mark.asyncio
async def test_prune_keeps_the_row_when_the_vectors_cannot_be_removed(lifecycle_session):
    file = _file(lifecycle_session)
    await lifecycle_session.flush()
    for generation, status, is_current in (
        (1, KnowledgeExtractionStatus.READY, False),
        (2, KnowledgeExtractionStatus.READY, True),
    ):
        lifecycle_session.add(
            _artifact(file_id=file.id, generation=generation, status=status, is_current=is_current),
        )
    await lifecycle_session.commit()

    store = RecordingVectorStore()
    store.failures.add(1)
    removed = await prune_superseded_generations(
        user_id="user-a",
        file_id=file.id,
        session=lifecycle_session,
        keep_previous=0,
        store=store,
    )

    # The row survives so the vectors stay addressable and the next prune retries.
    assert removed == 0
    remaining = sorted(
        await lifecycle_session.scalars(
            select(FileKnowledgeArtifactModel.generation).where(FileKnowledgeArtifactModel.file_id == file.id),
        ),
    )
    assert remaining == [1, 2]


@pytest.mark.asyncio
async def test_prune_uses_the_configured_retention_window(lifecycle_session, monkeypatch):
    monkeypatch.setattr(config, "knowledge_generation_retention", 2)
    file = _file(lifecycle_session)
    await lifecycle_session.flush()
    for generation, status, is_current in (
        (1, KnowledgeExtractionStatus.READY, False),
        (2, KnowledgeExtractionStatus.READY, False),
        (3, KnowledgeExtractionStatus.READY, False),
        (4, KnowledgeExtractionStatus.READY, True),
    ):
        lifecycle_session.add(
            _artifact(file_id=file.id, generation=generation, status=status, is_current=is_current),
        )
    await lifecycle_session.commit()

    store = RecordingVectorStore()
    removed = await prune_superseded_generations(
        user_id="user-a",
        file_id=file.id,
        session=lifecycle_session,
        store=store,
    )

    assert removed == 1
    assert store.deleted == [("user-a", str(file.id), 1)]


# --------------------------------------------------------------------------
# One-current-generation invariant, across dialects
# --------------------------------------------------------------------------


def test_one_current_generation_index_is_declared_for_every_partial_index_dialect():
    index = next(
        item
        for item in FileKnowledgeArtifactModel.__table__.indexes
        if item.name == "uq_file_knowledge_artifacts_one_current"
    )
    assert index.unique is True
    # The invariant must not silently disappear on the next storage adapter.
    for dialect in ("sqlite", "postgresql"):
        assert index.dialect_options[dialect]["where"] is not None, dialect


# --------------------------------------------------------------------------
# The artifact reported to the UI
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reporting_prefers_the_current_generation_over_a_newer_pending_one(lifecycle_session):
    file = _file(lifecycle_session)
    await lifecycle_session.flush()
    lifecycle_session.add(
        _artifact(
            file_id=file.id,
            generation=1,
            status=KnowledgeExtractionStatus.READY,
            is_current=True,
        ),
    )
    lifecycle_session.add(
        _artifact(
            file_id=file.id,
            generation=2,
            status=KnowledgeExtractionStatus.PENDING,
            is_current=False,
        ),
    )
    await lifecycle_session.commit()

    described = await describe_files(user_id="user-a", files=[file], session=lifecycle_session)
    assert described[0].knowledge is not None
    # The current generation is the one retrieval serves, so it is the one the
    # UI must report too.
    assert described[0].knowledge.generation == 1
    assert described[0].knowledge.is_current is True
    assert described[0].knowledge.status == KnowledgeExtractionStatus.READY


@pytest.mark.asyncio
async def test_reporting_falls_back_to_the_newest_generation_before_one_is_current(lifecycle_session):
    file = _file(lifecycle_session)
    await lifecycle_session.flush()
    lifecycle_session.add(
        _artifact(
            file_id=file.id,
            generation=1,
            status=KnowledgeExtractionStatus.PENDING,
            is_current=False,
        ),
    )
    await lifecycle_session.commit()

    described = await describe_files(user_id="user-a", files=[file], session=lifecycle_session)
    assert described[0].knowledge is not None
    # Nothing is serving the file yet, so the generation still being built is
    # the one that represents it.
    assert described[0].knowledge.generation == 1
    assert described[0].knowledge.status == KnowledgeExtractionStatus.PENDING


# --------------------------------------------------------------------------
# Ingestion wiring
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_promoting_a_generation_prunes_the_superseded_ones(lifecycle_session, tmp_path, monkeypatch):
    from asterism.domains.files.models import FileContentStatus
    from asterism.domains.files.store import get_file_store
    from asterism.domains.knowledge.ingestion import ingest_file

    monkeypatch.setattr(config, "storage_root", tmp_path)
    monkeypatch.setattr(config, "knowledge_generation_retention", 0)

    file = UserFileModel(
        storage_key=str(uuid.uuid4()),
        user_id="user-a",
        filename="indexed.txt",
        original_name="indexed.txt",
        size=11,
        mime_type="text/plain",
        kind=FileKind.TEXT,
        sha256="b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
        content_status=FileContentStatus.PENDING,
    )
    lifecycle_session.add(file)
    await lifecycle_session.commit()
    file.storage_key = get_file_store().save("user-a", file.id, ".txt", b"hello world")
    await lifecycle_session.commit()

    superseded = _artifact(
        file_id=file.id,
        generation=1,
        status=KnowledgeExtractionStatus.READY,
        is_current=True,
    )
    replacement = _artifact(
        file_id=file.id,
        generation=2,
        status=KnowledgeExtractionStatus.PENDING,
        is_current=False,
    )
    lifecycle_session.add_all([superseded, replacement])
    await lifecycle_session.commit()

    class FakeEmbeddings:
        dimension = 2

        async def embed_text(self, texts):
            return [[1.0, 0.0] for _ in texts]

        async def embed_image(self, images):
            return []

    store = RecordingVectorStore()
    promoted = await ingest_file(
        artifact=replacement,
        file=file,
        session=lifecycle_session,
        provider=FakeEmbeddings(),
        store=store,
    )

    assert promoted.status is KnowledgeExtractionStatus.READY
    assert promoted.is_current is True
    # Generation 2 is cleared before its vectors are written, then the
    # superseded generation 1 is pruned with its vectors.
    assert store.deleted == [
        ("user-a", str(file.id), 2),
        ("user-a", str(file.id), 1),
    ]
    remaining = sorted(
        await lifecycle_session.scalars(
            select(FileKnowledgeArtifactModel.generation).where(FileKnowledgeArtifactModel.file_id == file.id),
        ),
    )
    assert remaining == [2]
