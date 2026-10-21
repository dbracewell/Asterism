import json
import uuid
from pathlib import Path

import pytest
from asterism.domains.extraction.caption_schemas import (
    CaptionErrorCode,
    CaptioningConfiguration,
    CaptioningError,
    CaptionMode,
    CaptionRequest,
)
from asterism.domains.extraction.captioning import LocalSmolVlm2CaptionProvider, bounded_caption, caption_model
from asterism.domains.settings.provider_types import ModelCapabilitySource


class Model:
    def __init__(
        self,
        *,
        active: bool,
        vision: bool | None,
        source: ModelCapabilitySource = ModelCapabilitySource.PROVIDER,
    ) -> None:
        self.id = uuid.uuid4()
        self.is_active = active
        self.supports_vision = vision
        self.vision_source = source


def test_captioning_is_disabled_by_default_and_provider_needs_active_vision_model():
    CaptioningConfiguration().validate([])
    for source in (ModelCapabilitySource.PROVIDER, ModelCapabilitySource.MANUAL):
        vision = Model(active=True, vision=True, source=source)
        CaptioningConfiguration(mode=CaptionMode.PROVIDER, provider_model_id=vision.id).validate([vision])

    for model in (
        Model(active=False, vision=True),
        Model(active=True, vision=False),
        Model(active=True, vision=None),
    ):
        with pytest.raises(CaptioningError, match="vision-capable") as error:
            CaptioningConfiguration(mode=CaptionMode.PROVIDER, provider_model_id=model.id).validate([model])
        assert error.value.code is CaptionErrorCode.INVALID_SELECTION


@pytest.mark.parametrize(
    "configuration",
    [
        CaptioningConfiguration(mode=CaptionMode.PROVIDER),
        CaptioningConfiguration(mode=CaptionMode.LOCAL, provider_model_id=uuid.uuid4()),
        CaptioningConfiguration(mode=CaptionMode.DISABLED, provider_model_id=uuid.uuid4()),
    ],
)
def test_captioning_configuration_rejects_invalid_mode_selection(configuration):
    with pytest.raises(CaptioningError) as error:
        configuration.validate([])
    assert error.value.code is CaptionErrorCode.INVALID_SELECTION


@pytest.mark.asyncio
async def test_local_captioning_never_initializes_without_a_provisioned_manifest(tmp_path: Path):
    provider = LocalSmolVlm2CaptionProvider(tmp_path, pinned_model=caption_model)
    with pytest.raises(CaptioningError, match="not provisioned") as error:
        await provider.initialize()
    assert error.value.code is CaptionErrorCode.NOT_READY


@pytest.mark.asyncio
async def test_local_captioning_verifies_manifest_and_all_declared_files_before_loading(tmp_path: Path):
    model_file = tmp_path / "weights.safetensors"
    model_file.write_bytes(b"expected weights")
    manifest = {
        "model_id": caption_model.id,
        "revision": caption_model.revision,
        "files": {"weights.safetensors": "0" * 64},
    }
    manifest_bytes = json.dumps(manifest).encode()
    (tmp_path / "manifest.json").write_bytes(manifest_bytes)
    provider = LocalSmolVlm2CaptionProvider(tmp_path, pinned_model=caption_model)

    with pytest.raises(CaptioningError, match="manifest is invalid") as error:
        await provider.initialize()
    assert error.value.code is CaptionErrorCode.NOT_READY


def test_caption_output_is_normalized_and_bounded():
    assert bounded_caption(" a\n  useful\timage ", 100) == "a useful image"
    assert bounded_caption("123456", 4) == "1234"
    with pytest.raises(CaptioningError) as error:
        bounded_caption(" \n", 4)
    assert error.value.code is CaptionErrorCode.OUTPUT_INVALID


def test_local_caption_request_is_a_path_reference_not_image_bytes(tmp_path: Path):
    request = CaptionRequest(
        file=None,  # type: ignore[arg-type]
        revision_id=uuid.uuid4(),
        image_path=tmp_path / "image.png",
        max_image_bytes=1,
        max_caption_chars=1,
    )
    assert request.image_path.name == "image.png"


@pytest.mark.asyncio
async def test_caption_job_transitions_directly_to_ready_and_enables_text_retrieval(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from contextlib import asynccontextmanager

    from asterism.db.model_registry import Base
    from asterism.domains.extraction.caption_schemas import CaptionResult
    from asterism.domains.extraction.captioning import caption
    from asterism.domains.extraction.models import (
        FileExtractionModel,
        FileKnowledgeArtifactStatus,
        KnowledgeCaptionStatus,
    )
    from asterism.domains.files.models import FileKind, UserFileModel
    from asterism.domains.retrieval.service import RetrievalArtifact
    from asterism.domains.user.models import UserModel
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'caption-ready.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add(UserModel(id="user-1"))
        file = UserFileModel(
            storage_key=str(uuid.uuid4()),
            user_id="user-1",
            filename="chart.png",
            original_name="chart.png",
            size=128,
            mime_type="image/png",
            kind=FileKind.IMAGE,
            sha256="a" * 64,
        )
        session.add(file)
        await session.flush()

        artifact = FileExtractionModel(
            user_id="user-1",
            file_id=file.id,
            generation=1,
            processing_profile_generation=1,
            processing_profile_identity="b" * 64,
            status=FileKnowledgeArtifactStatus.READY,
            is_current=True,
            text_embeddings_ready=False,
            visual_embedding_ready=True,
            caption_status=KnowledgeCaptionStatus.PENDING,
        )
        session.add(artifact)
        await session.commit()

        file_id = file.id
        artifact_id = artifact.id

    @asynccontextmanager
    async def session_factory():
        async with sessions() as db_session:
            yield db_session

    added_chunks = []

    class FakeVectorStore:
        async def delete_chunk(self, **_kwargs: object) -> None:
            return None

        async def add(self, chunks: list[object]) -> None:
            added_chunks.extend(chunks)

    class FakeEmbeddingProvider:
        async def embed_text(self, _texts: list[str]) -> list[list[float]]:
            return [[0.5, 0.5]]

    async def fake_caption(*_args: object, **_kwargs: object) -> CaptionResult:
        return CaptionResult(
            text="A bar chart of quarterly revenue",
            source=CaptionMode.LOCAL,
            model="local/smolvlm2",
        )

    monkeypatch.setattr("asterism.domains.extraction.captioning.get_async_db_session", session_factory)
    monkeypatch.setattr("asterism.domains.extraction.captioning.vector_store", FakeVectorStore())
    monkeypatch.setattr("asterism.domains.extraction.captioning.embedding_provider", FakeEmbeddingProvider())
    monkeypatch.setattr("asterism.domains.extraction.captioning._caption", fake_caption)

    await caption("user-1", file_id, artifact_id)

    async with sessions() as session:
        updated = await session.get(FileExtractionModel, artifact_id)
        assert updated is not None
        assert updated.caption_status == KnowledgeCaptionStatus.READY
        assert updated.caption_text == "A bar chart of quarterly revenue"
        assert updated.text_embeddings_ready is True
        retrieval_artifact = RetrievalArtifact(
            file_id=updated.file_id,
            generation=updated.generation,
            status=updated.status,
            text_embeddings_ready=updated.text_embeddings_ready,
        )
        assert retrieval_artifact.ready is True

    assert len(added_chunks) == 1
    await engine.dispose()
