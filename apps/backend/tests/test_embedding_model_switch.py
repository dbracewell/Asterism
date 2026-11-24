"""US-99.2 (ADR-0079): switching the embedding model re-embeds every file, and
images keep a caption made by the current captioner instead of being captioned
again."""

import uuid

import pytest
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.knowledge.embedding import EMBEDDING_MODEL_KEY
from asterism.domains.knowledge.ingestion import ingest_file
from asterism.domains.knowledge.models import (
    FileKnowledgeArtifactModel,
    FileKnowledgeExtractionModel,
    KnowledgeExtractionKind,
    KnowledgeExtractionStatus,
)
from asterism.domains.knowledge.policy import (
    default_processing_configuration,
    load_processing_configuration,
    processing_identity,
    save_processing_configuration,
)
from asterism.domains.knowledge.processing import reembed_for_current_model
from asterism.domains.knowledge.processing_schemas import KnowledgeProcessingCaptioningConfiguration
from knowledge_doubles import FakeSourceReader
from sqlalchemy import select
from test_knowledge_processing import processing_session as _processing_session

pytestmark = pytest.mark.asyncio
processing_session = _processing_session


async def store_policy(session, *, embedding_model: str, mode: str = "disabled") -> None:
    captioning = KnowledgeProcessingCaptioningConfiguration(mode=mode)  # pyright: ignore[reportArgumentType]
    base = default_processing_configuration()
    configuration = base.model_copy(
        update={
            "embedding_model": embedding_model,
            "captioning": captioning,
            "identity": processing_identity(
                extraction_policy=base.extraction_policy,
                chunking_policy=base.chunking_policy,
                embedding_model=embedding_model,
                captioning_policy=base.captioning_policy,
                captioning=captioning,
            ),
        }
    )
    save_processing_configuration(setting=None, configuration=configuration, session=session)
    await session.commit()


async def add_file(session, *, image: bool) -> UserFileModel:
    name = f"{uuid.uuid4().hex[:8]}-{'bike.png' if image else 'notes.txt'}"
    file = UserFileModel(
        storage_key=str(uuid.uuid4()),
        user_id="user-a",
        filename=name,
        original_name=name,
        size=1,
        mime_type="image/png" if image else "text/plain",
        kind=FileKind.IMAGE if image else FileKind.TEXT,
        sha256="f" * 64,
    )
    session.add(file)
    await session.flush()
    return file


async def add_artifact(session, file, *, generation: int, status=KnowledgeExtractionStatus.READY):
    artifact = FileKnowledgeArtifactModel(
        user_id=file.user_id,
        file_id=file.id,
        generation=generation,
        processing_profile_generation=generation,
        status=status,
        is_current=status is KnowledgeExtractionStatus.READY,
    )
    session.add(artifact)
    await session.flush()
    for kind in (KnowledgeExtractionKind.TEXT_EXTRACTION, KnowledgeExtractionKind.EMBEDDING):
        session.add(
            FileKnowledgeExtractionModel(artifact_id=artifact.id, kind=kind, status=KnowledgeExtractionStatus.PENDING)
        )
    await session.flush()
    return artifact


async def test_files_embedded_by_another_model_are_queued_again(processing_session, monkeypatch):
    queued: list[uuid.UUID] = []
    monkeypatch.setattr(
        "asterism.domains.knowledge.processing.start_file_ingestion_job",
        lambda *, user_id, file_id, artifact_id: queued.append(file_id),
    )
    await store_policy(processing_session, embedding_model="onnx-clip-v1")
    file = await add_file(processing_session, image=False)
    await add_artifact(processing_session, file, generation=1)
    await processing_session.commit()

    summary = await reembed_for_current_model(session=processing_session)

    assert summary is not None and summary.queued_file_count == 1
    assert queued == [file.id]
    _, configuration = await load_processing_configuration(session=processing_session)
    assert (configuration.embedding_model, configuration.generation) == (EMBEDDING_MODEL_KEY, 2)
    generations = (
        await processing_session.scalars(
            select(FileKnowledgeArtifactModel.processing_profile_generation).where(
                FileKnowledgeArtifactModel.file_id == file.id
            )
        )
    ).all()
    assert sorted(generations) == [1, 2]
    # Starting again changes nothing.
    assert await reembed_for_current_model(session=processing_session) is None


class Embeddings:
    dimension = 2

    def __init__(self):
        self.passages: list[str] = []

    async def initialize(self):
        pass

    async def embed_passage(self, texts):
        self.passages.extend(texts)
        return [[1.0, 0.0] for _ in texts]

    embed_query = embed_passage

    async def close(self):
        pass


class Vectors:
    def __init__(self):
        self.chunks = []

    async def add(self, chunks):
        self.chunks.extend(chunks)

    async def delete_file_generation(self, **_):
        pass


async def ingest_new_generation(session, *, mode: str, caption: dict):
    await store_policy(session, embedding_model=EMBEDDING_MODEL_KEY, mode=mode)
    file = await add_file(session, image=True)
    old = await add_artifact(session, file, generation=1)
    session.add(
        FileKnowledgeExtractionModel(
            artifact_id=old.id,
            kind=KnowledgeExtractionKind.CAPTIONING,
            status=KnowledgeExtractionStatus.READY,
            **caption,
        )
    )
    new = await add_artifact(session, file, generation=2, status=KnowledgeExtractionStatus.PENDING)
    await session.commit()
    embeddings, vectors = Embeddings(), Vectors()
    reader = FakeSourceReader(is_image=True, name="bike.png", mime_type="image/png")
    artifact = await ingest_file(artifact=new, reader=reader, session=session, provider=embeddings, store=vectors)
    captioning = await session.scalar(
        select(FileKnowledgeExtractionModel).where(
            FileKnowledgeExtractionModel.artifact_id == new.id,
            FileKnowledgeExtractionModel.kind == KnowledgeExtractionKind.CAPTIONING,
        )
    )
    return artifact, captioning, embeddings, vectors


async def test_an_image_keeps_its_caption_from_the_current_captioner(processing_session):
    artifact, captioning, embeddings, vectors = await ingest_new_generation(
        processing_session,
        mode="local",
        # A caption from before ADR-0079: no captioner key, matched by mode and label.
        caption={"provider": "local", "model": "SmolVLM2", "payload": {"text": "A red bicycle"}},
    )
    assert artifact.status is KnowledgeExtractionStatus.READY
    assert artifact.searchable is True
    assert embeddings.passages == ["A red bicycle"]
    assert [(chunk.kind, chunk.content) for chunk in vectors.chunks] == [("caption", "A red bicycle")]
    assert captioning is not None
    assert captioning.status is KnowledgeExtractionStatus.READY
    assert captioning.payload == {"text": "A red bicycle"}


async def test_another_captioners_caption_is_not_reused(processing_session):
    artifact, captioning, embeddings, vectors = await ingest_new_generation(
        processing_session,
        mode="local",
        caption={"provider": "provider", "model": "openai/gpt-x", "payload": {"text": "A red bicycle"}},
    )
    # The image waits for a new caption and isn't searchable until then.
    assert artifact.searchable is False
    assert embeddings.passages == [] and vectors.chunks == []
    assert captioning is not None and captioning.status is KnowledgeExtractionStatus.PENDING


async def test_with_captioning_off_an_image_is_not_searchable(processing_session):
    artifact, captioning, _, vectors = await ingest_new_generation(
        processing_session,
        mode="disabled",
        caption={"provider": "local", "model": "SmolVLM2", "payload": {"text": "A red bicycle", "captioner": "local:"}},
    )
    assert artifact.searchable is False
    assert vectors.chunks == []
    assert captioning is None


async def test_start_removes_the_old_bundle_and_queues_the_files(processing_session, monkeypatch, tmp_path):
    from contextlib import asynccontextmanager
    from types import SimpleNamespace

    from asterism.domains.knowledge import processing

    legacy = tmp_path / "models" / "knowledge-clip"
    legacy.mkdir(parents=True)
    (legacy / "model.onnx").write_bytes(b"clip")

    @asynccontextmanager
    async def session_context():
        yield processing_session

    monkeypatch.setattr(processing, "config", SimpleNamespace(legacy_knowledge_models_root=legacy))
    monkeypatch.setattr(processing, "get_async_db_session", session_context)
    monkeypatch.setattr(processing, "start_file_ingestion_job", lambda **_: True)
    await store_policy(processing_session, embedding_model="onnx-clip-v1")
    file = await add_file(processing_session, image=False)
    await add_artifact(processing_session, file, generation=1)
    await processing_session.commit()

    await processing.retire_previous_embedding_model()

    assert not legacy.exists()
    _, configuration = await load_processing_configuration(session=processing_session)
    assert configuration.embedding_model == EMBEDDING_MODEL_KEY


async def test_counts_images_search_cannot_find(processing_session):
    """US-99.3: the captioning pane says how many images have no caption."""
    from asterism.domains.knowledge.queries import select_uncaptioned_image_counts

    async def artifact(*, image: bool, searchable: bool, current=True, caption=None):
        file = await add_file(processing_session, image=image)
        row = await add_artifact(
            processing_session,
            file,
            generation=1,
            status=KnowledgeExtractionStatus.READY,
        )
        row.searchable, row.is_current = searchable, current
        if caption is not None:
            processing_session.add(
                FileKnowledgeExtractionModel(
                    artifact_id=row.id, kind=KnowledgeExtractionKind.CAPTIONING, status=caption
                )
            )

    await artifact(image=False, searchable=True)  # a text file
    await artifact(image=True, searchable=True, caption=KnowledgeExtractionStatus.READY)  # captioned
    await artifact(image=True, searchable=False, caption=KnowledgeExtractionStatus.PENDING)  # waiting
    await artifact(image=True, searchable=False)  # captioning off
    await artifact(image=True, searchable=False, caption=KnowledgeExtractionStatus.FAILED)  # failed
    await artifact(image=True, searchable=False, current=False)  # an old generation
    await processing_session.commit()

    assert tuple((await processing_session.execute(select_uncaptioned_image_counts())).one()) == (3, 1)


async def test_a_damaged_image_fails_processing(processing_session):
    """A cut-off image isn't decoded to be embedded, so ingestion checks it can be read."""
    await store_policy(processing_session, embedding_model=EMBEDDING_MODEL_KEY, mode="disabled")
    file = await add_file(processing_session, image=True)
    artifact = await add_artifact(processing_session, file, generation=1, status=KnowledgeExtractionStatus.PENDING)
    await processing_session.commit()
    reader = FakeSourceReader(
        is_image=True, name="worksheet.jpg", mime_type="image/jpeg", image=b"Not a real photo: the upload was cut off."
    )
    result = await ingest_file(
        artifact=artifact, reader=reader, session=processing_session, provider=Embeddings(), store=Vectors()
    )
    assert result.status is KnowledgeExtractionStatus.FAILED
    assert result.error_reason == "The image could not be read; the file may be damaged or incomplete"
    embedding = await processing_session.scalar(
        select(FileKnowledgeExtractionModel).where(
            FileKnowledgeExtractionModel.artifact_id == artifact.id,
            FileKnowledgeExtractionModel.kind == KnowledgeExtractionKind.EMBEDDING,
        )
    )
    # The Files library shows the embedding's state, so that is what fails.
    assert embedding is not None and embedding.status is KnowledgeExtractionStatus.FAILED
