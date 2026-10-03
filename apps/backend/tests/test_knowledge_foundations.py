from pathlib import Path

import pytest
from asterism.core.config import Config, ConfigValidationError
from asterism.db.base import Base
from asterism.domains.extraction.embedding import EmbeddingProviderError, OnnxClipEmbeddingProvider, embedding_model
from asterism.domains.extraction.models import FileExtractionModel, FileKnowledgeArtifactStatus
from asterism.domains.extraction.schemas import FileKnowledgeArtifact
from asterism.domains.extraction.vector_store import LanceDbVectorStore, VectorChunk
from asterism.domains.files.models import FileKind, UserFileModel
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine


@pytest.mark.asyncio
async def test_lancedb_filters_by_owner_and_allowed_file_and_deletes(tmp_path: Path):
    store = LanceDbVectorStore(tmp_path / "vectors", dimension=2, max_concurrency=1)
    await store.add(
        [
            VectorChunk("one", "user-a", "file-a", 1, 0, "private", [1.0, 0.0]),
            VectorChunk("two", "user-a", "file-b", 1, 0, "other file", [0.9, 0.1]),
            VectorChunk("three", "user-b", "file-a", 1, 0, "other user", [1.0, 0.0]),
        ],
    )

    results = await store.search(
        [1.0, 0.0],
        user_id="user-a",
        allowed_file_ids=["file-a"],
        limit=10,
    )
    assert [(item.id, item.content) for item in results] == [("one", "private")]
    assert await store.search([1.0, 0.0], user_id="user-a", allowed_file_ids=[], limit=10) == []

    await store.delete_file_generation(user_id="user-a", file_id="file-a", artifact_generation=1)
    assert await store.search([1.0, 0.0], user_id="user-a", allowed_file_ids=["file-a"], limit=1) == []

    await store.delete_file(user_id="user-a", file_id="file-b")
    assert await store.search([1.0, 0.0], user_id="user-a", allowed_file_ids=["file-b"], limit=1) == []
    await store.close()
    # Application test lifespans may start/stop in the same process.
    await store.initialize()
    assert await store.search([1.0, 0.0], user_id="user-b", allowed_file_ids=["file-a"], limit=1)


@pytest.mark.asyncio
async def test_lancedb_rejects_wrong_dimension(tmp_path: Path):
    store = LanceDbVectorStore(tmp_path / "vectors", dimension=2)
    with pytest.raises(ValueError, match="dimension"):
        await store.add([VectorChunk("one", "user", "file", 1, 0, "text", [1.0])])
    with pytest.raises(ValueError, match="dimension"):
        await store.search([1.0], user_id="user", allowed_file_ids=["file"], limit=1)


@pytest.mark.asyncio
async def test_knowledge_schema_is_created_from_models(tmp_path: Path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'knowledge.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        tables = {
            row[0]
            for row in (
                await connection.execute(text("SELECT name FROM sqlite_master WHERE type = 'table'"))
            ).fetchall()
        }
    await engine.dispose()
    assert {
        "knowledge_bases",
        "agent_knowledge_base_assignments",
        "file_extractions",
        "knowledge_base_files",
    } <= tables
    assert "knowledge_documents" not in tables
    assert "knowledge_audit_events" not in tables
    assert "knowledge_caption_configuration" not in tables
    assert "knowledge_processing_profile" not in tables


@pytest.mark.asyncio
async def test_file_artifact_contract_keeps_one_current_generation_per_file(tmp_path: Path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'artifacts.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await connection.execute(text("INSERT INTO users (id) VALUES ('user-a')"))
    from sqlalchemy.ext.asyncio import async_sessionmaker

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        user_file = UserFileModel(
            user_id="user-a",
            filename="report.txt",
            original_name="report.txt",
            size=1,
            mime_type="text/plain",
            kind=FileKind.TEXT,
            sha256="a" * 64,
        )
        session.add(user_file)
        await session.flush()
        session.add_all(
            [
                FileExtractionModel(
                    user_id="user-a",
                    file_id=user_file.id,
                    generation=1,
                    processing_profile_generation=1,
                    processing_profile_identity="b" * 64,
                    status=FileKnowledgeArtifactStatus.READY,
                    is_current=True,
                ),
                FileExtractionModel(
                    user_id="user-a",
                    file_id=user_file.id,
                    generation=2,
                    processing_profile_generation=2,
                    processing_profile_identity="c" * 64,
                    status=FileKnowledgeArtifactStatus.PROCESSING,
                    is_current=False,
                ),
            ],
        )
        await session.commit()
        artifact = await session.scalar(
            select(FileExtractionModel).where(
                FileExtractionModel.file_id == user_file.id,
                FileExtractionModel.generation == 1,
            ),
        )
        assert artifact is not None
        assert FileKnowledgeArtifact.model_validate(artifact).caption.model_dump() == {
            "status": None,
            "source": None,
            "model": None,
            "text": None,
            "error_code": None,
            "error_reason": None,
            "generated_at": None,
            "accepted_at": None,
        }

        duplicate_current = FileExtractionModel(
            user_id="user-a",
            file_id=user_file.id,
            generation=3,
            processing_profile_generation=3,
            processing_profile_identity="d" * 64,
            is_current=True,
        )
        session.add(duplicate_current)
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()
    await engine.dispose()


def test_embedding_artifact_requires_expected_checksum_and_size(tmp_path: Path):
    artifact = tmp_path / "model.onnx"
    artifact.write_bytes(b"known-artifact")
    provider = OnnxClipEmbeddingProvider(tmp_path, pinned_model=embedding_model)
    with pytest.raises(EmbeddingProviderError, match="manifest verification"):
        provider._initialize_sync()




def test_caption_configuration_accepts_unprovisioned_local_mode_and_rejects_invalid_bundle_digest(tmp_path: Path):
    settings = Config(
        _env_file=None,
        storage_root=tmp_path,
        config_profile="development",
        system_key="not-a-placeholder-secret",
    )
    settings.validate_runtime()
    assert settings.local_caption_models_root == tmp_path / "models" / "captioning-smolvlm2"

    invalid = Config(
        _env_file=None,
        storage_root=tmp_path,
        config_profile="development",
        system_key="not-a-placeholder-secret",
        local_caption_model_bundle_sha256="not-a-digest",
    )
    with pytest.raises(ConfigValidationError, match="LOCAL_CAPTION_MODEL_BUNDLE_SHA256"):
        invalid.validate_runtime()
