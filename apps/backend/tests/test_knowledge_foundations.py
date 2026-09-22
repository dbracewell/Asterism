import hashlib
from pathlib import Path

import pytest
from asterism.core.config import Config, ConfigValidationError
from asterism.db.base import Base
from asterism.db.schema_migrations import run_schema_migrations
from asterism.domains.knowledge.embeddings import EmbeddingProviderError, OnnxClipEmbeddingProvider
from asterism.domains.knowledge.vector_store import LanceDbVectorStore, VectorChunk
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


@pytest.mark.asyncio
async def test_lancedb_filters_by_owner_and_assigned_base_and_deletes(tmp_path: Path):
    store = LanceDbVectorStore(tmp_path / "vectors", dimension=2, max_concurrency=1)
    await store.add(
        [
            VectorChunk("one", "user-a", "base-a", "doc-a", "revision-a", "private", [1.0, 0.0]),
            VectorChunk("two", "user-a", "base-b", "doc-b", "revision-b", "other base", [0.9, 0.1]),
            VectorChunk("three", "user-b", "base-a", "doc-c", "revision-c", "other user", [1.0, 0.0]),
        ]
    )

    results = await store.search(
        [1.0, 0.0],
        user_id="user-a",
        knowledge_base_ids=["base-a"],
        limit=10,
    )
    assert [(item.id, item.content) for item in results] == [("one", "private")]

    await store.delete_document(user_id="user-a", document_id="doc-a")
    assert await store.search([1.0, 0.0], user_id="user-a", knowledge_base_ids=["base-a"], limit=1) == []

    await store.delete_knowledge_base(user_id="user-a", knowledge_base_id="base-b")
    assert await store.search([1.0, 0.0], user_id="user-a", knowledge_base_ids=["base-b"], limit=1) == []
    await store.close()
    # Application test lifespans may start/stop in the same process.
    await store.initialize()
    assert await store.search([1.0, 0.0], user_id="user-b", knowledge_base_ids=["base-a"], limit=1)


@pytest.mark.asyncio
async def test_lancedb_rejects_wrong_dimension(tmp_path: Path):
    store = LanceDbVectorStore(tmp_path / "vectors", dimension=2)
    with pytest.raises(ValueError, match="dimension"):
        await store.add([VectorChunk("one", "user", "base", "doc", "rev", "text", [1.0])])
    with pytest.raises(ValueError, match="dimension"):
        await store.search([1.0], user_id="user", knowledge_base_ids=["base"], limit=1)


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
    } <= tables


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
