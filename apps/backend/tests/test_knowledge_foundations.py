import hashlib
from pathlib import Path

import pytest
from asterism.core.config import Config, ConfigValidationError
from asterism.db.base import Base
from asterism.db.schema_migrations import run_schema_migrations
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.knowledge.embeddings import EmbeddingProviderError, OnnxClipEmbeddingProvider
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel, FileKnowledgeArtifactStatus
from asterism.domains.knowledge.schemas import FileKnowledgeArtifact
from asterism.domains.knowledge.vector_store import LanceDbVectorStore, VectorChunk
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
        ]
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
async def test_knowledge_migration_is_idempotent(tmp_path: Path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'knowledge.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await run_schema_migrations(connection)
        await run_schema_migrations(connection)
        tables = {
            row[0]
            for row in (
                await connection.execute(text("SELECT name FROM sqlite_master WHERE type = 'table'"))
            ).fetchall()
        }
    await engine.dispose()
    assert {
        "knowledge_bases",
        "knowledge_documents",
        "knowledge_audit_events",
        "agent_knowledge_base_assignments",
        "knowledge_processing_profile",
        "file_knowledge_artifacts",
        "knowledge_base_files",
    } <= tables


@pytest.mark.asyncio
async def test_file_artifact_contract_keeps_one_current_generation_per_file(tmp_path: Path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'artifacts.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await run_schema_migrations(connection)
        profile = (
            await connection.execute(text("SELECT generation, identity FROM knowledge_processing_profile WHERE id = 1"))
        ).one()
        assert profile.generation == 1
        assert len(profile.identity) == 64
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
                FileKnowledgeArtifactModel(
                    user_id="user-a",
                    file_id=user_file.id,
                    generation=1,
                    processing_profile_generation=1,
                    processing_profile_identity="b" * 64,
                    status=FileKnowledgeArtifactStatus.READY,
                    is_current=True,
                ),
                FileKnowledgeArtifactModel(
                    user_id="user-a",
                    file_id=user_file.id,
                    generation=2,
                    processing_profile_generation=2,
                    processing_profile_identity="c" * 64,
                    status=FileKnowledgeArtifactStatus.PROCESSING,
                    is_current=False,
                ),
            ]
        )
        await session.commit()
        artifact = await session.scalar(
            select(FileKnowledgeArtifactModel).where(
                FileKnowledgeArtifactModel.file_id == user_file.id,
                FileKnowledgeArtifactModel.generation == 1,
            )
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

        duplicate_current = FileKnowledgeArtifactModel(
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
    provider = OnnxClipEmbeddingProvider(
        tmp_path,
        artifact_sha256=hashlib.sha256(b"different").hexdigest(),
        artifact_size_bytes=len(b"known-artifact"),
    )
    with pytest.raises(EmbeddingProviderError, match="checksum"):
        provider._verify_artifact()


def test_knowledge_configuration_rejects_oversize_model(tmp_path: Path):
    settings = Config(
        _env_file=None,
        storage_root=tmp_path,
        config_profile="development",
        system_key="not-a-placeholder-secret",
        knowledge_embedding_model_size_bytes=400 * 1024 * 1024 + 1,
    )
    with pytest.raises(ConfigValidationError, match="KNOWLEDGE_EMBEDDING_MODEL_SIZE_BYTES"):
        settings.validate_runtime()


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
