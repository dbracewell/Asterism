import json
import sqlite3
import uuid

import pytest
from asterism.core import config
from asterism.db.base import Base
from asterism.db.init_db import initialize_database
from asterism.db.schema_migrations import run_schema_migrations
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.provider_types import (
    OPENAI_BASE_URL,
    ModelCapabilitySource,
    ProviderType,
)
from asterism.domains.settings.schemas import (
    BulkUpdateSettingRequest,
    Llm,
    Provider,
)
from asterism.domains.settings.service import (
    bulk_update_app_setting,
    bulk_upsert_providers,
    get_all_providers,
    get_app_settings,
)
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


def _provider(*, provider_type: ProviderType, base_url: str) -> Provider:
    provider_id = uuid.uuid4()
    return Provider(
        id=provider_id,
        provider_type=provider_type,
        name=f"provider-{provider_id}",
        base_url=base_url,
        api_key="secret",
        models=[],
    )


def test_openai_provider_always_uses_canonical_url():
    provider = _provider(
        provider_type=ProviderType.OPENAI,
        base_url="https://untrusted.example/v1",
    )

    assert provider.base_url == OPENAI_BASE_URL


def test_generic_provider_normalizes_absolute_http_url():
    provider = _provider(
        provider_type=ProviderType.GENERIC_OPENAI,
        base_url="HTTP://LOCALHOST:8080/v1///",
    )

    assert provider.base_url == "http://localhost:8080/v1"


@pytest.mark.parametrize(
    "base_url",
    [
        "",
        "localhost:8080/v1",
        "ftp://example.test/v1",
        "https://user:password@example.test/v1",
        "https://example.test/v1?token=secret",
        "https://example.test/v1#models",
    ],
)
def test_generic_provider_rejects_invalid_or_unsafe_url(base_url):
    with pytest.raises(ValidationError):
        _provider(
            provider_type=ProviderType.GENERIC_OPENAI,
            base_url=base_url,
        )


def test_capability_values_default_to_manual_provenance():
    model = Llm(
        id=uuid.uuid4(),
        provider_id=uuid.uuid4(),
        name="vision-model",
        is_active=True,
        context_window=128_000,
        supports_vision=False,
    )

    assert model.context_window_source == ModelCapabilitySource.MANUAL
    assert model.vision_source == ModelCapabilitySource.MANUAL


def test_unknown_capabilities_remain_tristate_and_reject_invalid_context():
    model = Llm(
        id=uuid.uuid4(),
        provider_id=uuid.uuid4(),
        name="unknown-model",
        is_active=True,
        context_window=None,
        supports_vision=None,
        context_window_source=ModelCapabilitySource.PROVIDER,
        vision_source=ModelCapabilitySource.CATALOG,
    )

    assert model.context_window_source == ModelCapabilitySource.UNKNOWN
    assert model.vision_source == ModelCapabilitySource.UNKNOWN
    with pytest.raises(ValidationError):
        Llm(
            id=uuid.uuid4(),
            provider_id=uuid.uuid4(),
            name="invalid-model",
            is_active=True,
            context_window=0,
        )


@pytest.mark.asyncio
async def test_provider_capabilities_round_trip_and_merge(tmp_path):
    database = tmp_path / "round-trip.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await run_schema_migrations(connection)

    provider_id = uuid.uuid4()
    model_id = uuid.uuid4()
    provider = Provider(
        id=provider_id,
        provider_type=ProviderType.OPENAI,
        name="OpenAI",
        base_url="https://ignored.example/v1",
        api_key="secret",
        models=[
            Llm(
                id=model_id,
                provider_id=provider_id,
                name="gpt-test",
                is_active=True,
                context_window=128_000,
                supports_vision=True,
                context_window_source=ModelCapabilitySource.CATALOG,
                vision_source=ModelCapabilitySource.CATALOG,
            )
        ],
    )

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        await bulk_upsert_providers([provider], session)
        await session.commit()
        stored = Provider.model_validate((await get_all_providers(session))[0])

        assert stored.provider_type == ProviderType.OPENAI
        assert stored.base_url == OPENAI_BASE_URL
        assert stored.models[0].id == model_id
        assert stored.models[0].context_window == 128_000
        assert stored.models[0].supports_vision is True

        updated = provider.model_copy(deep=True)
        updated.models[0].context_window = 64_000
        updated.models[0].context_window_source = ModelCapabilitySource.MANUAL
        await bulk_upsert_providers([updated], session)
        await session.commit()
        merged = Provider.model_validate((await get_all_providers(session))[0])

        assert merged.models[0].id == model_id
        assert merged.models[0].context_window == 64_000
        assert merged.models[0].context_window_source == ModelCapabilitySource.MANUAL

    await engine.dispose()


@pytest.mark.asyncio
async def test_empty_draft_model_form_value_is_normalized_and_recovered(tmp_path):
    database = tmp_path / "empty-draft.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add(ApplicationSettingsModel(key="draft_model_id", value=""))
        await session.commit()

        recovered = await get_app_settings(session)
        assert recovered.draft_model_id is None

        updated = await bulk_update_app_setting(
            BulkUpdateSettingRequest(values={"draft_model_id": ""}),
            session,
        )
        assert updated.draft_model_id is None
        stored = await session.get(ApplicationSettingsModel, "draft_model_id")
        assert stored is not None
        assert stored.value is None

    await engine.dispose()


def _create_legacy_provider_schema(database):
    provider_id = uuid.uuid4()
    generic_provider_id = uuid.uuid4()
    model_id = uuid.uuid4()
    draft_value = json.dumps(str(model_id))
    with sqlite3.connect(database) as connection:
        connection.executescript(
            """
            CREATE TABLE providers (
                id CHAR(32) PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE models (
                id CHAR(32) PRIMARY KEY,
                name TEXT NOT NULL,
                is_active BOOLEAN NOT NULL,
                provider_id CHAR(32) NOT NULL REFERENCES providers(id)
            );
            CREATE INDEX ix_models_provider_id ON models(provider_id);
            CREATE TABLE app_settings (
                key VARCHAR PRIMARY KEY,
                value JSON NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            """
        )
        connection.execute(
            "INSERT INTO providers VALUES (?, ?, ?, ?, 1, 1)",
            (
                provider_id.hex,
                "OpenAI",
                "https://api.openai.com/v1/",
                "preserved-key",
            ),
        )
        connection.execute(
            "INSERT INTO providers VALUES (?, ?, ?, ?, 1, 1)",
            (
                generic_provider_id.hex,
                "Local",
                "http://localhost:8080/v1",
                "local-key",
            ),
        )
        connection.execute(
            "INSERT INTO models VALUES (?, ?, ?, ?)",
            (model_id.hex, "gpt-legacy", True, provider_id.hex),
        )
        connection.execute(
            "INSERT INTO app_settings VALUES ('draft_model_id', ?, 1, 1)",
            (draft_value,),
        )
        connection.commit()
    return provider_id, generic_provider_id, model_id, draft_value


@pytest.mark.asyncio
async def test_initialization_migrates_legacy_provider_data_once(tmp_path, monkeypatch):
    database = tmp_path / "legacy.db"
    provider_id, generic_provider_id, model_id, draft_value = (
        _create_legacy_provider_schema(database)
    )
    monkeypatch.setattr(config, "storage_root", tmp_path)
    monkeypatch.setattr(config, "db_url", f"sqlite+aiosqlite:///{database}")

    await initialize_database()
    await initialize_database()

    with sqlite3.connect(database) as connection:
        provider_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(providers)")
        }
        model_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(models)")
        }
        user_file_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(user_files)")
        }
        provider_rows = connection.execute(
            "SELECT id, provider_type, base_url, api_key FROM providers ORDER BY name"
        ).fetchall()
        model_row = connection.execute(
            "SELECT id, context_window, supports_vision, "
            "context_window_source, vision_source FROM models"
        ).fetchone()
        stored_draft = connection.execute(
            "SELECT value FROM app_settings WHERE key = 'draft_model_id'"
        ).fetchone()
        migration_count = connection.execute(
            "SELECT count(*) FROM asterism_schema_migrations"
        ).fetchone()
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE providers SET provider_type = 'unsupported' "
                "WHERE id = ?",
                (provider_id.hex,),
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE models SET context_window = -1 WHERE id = ?",
                (model_id.hex,),
            )

    assert "provider_type" in provider_columns
    assert {
        "context_window",
        "supports_vision",
        "context_window_source",
        "vision_source",
    }.issubset(model_columns)
    assert provider_rows == [
        (
            generic_provider_id.hex,
            ProviderType.GENERIC_OPENAI.value,
            "http://localhost:8080/v1",
            "local-key",
        ),
        (
            provider_id.hex,
            ProviderType.OPENAI.value,
            OPENAI_BASE_URL,
            "preserved-key",
        ),
    ]
    assert model_row == (
        model_id.hex,
        None,
        None,
        ModelCapabilitySource.UNKNOWN.value,
        ModelCapabilitySource.UNKNOWN.value,
    )
    assert stored_draft == (draft_value,)
    assert {
        "id", "user_id", "filename", "original_name", "size", "mime_type", "kind",
        "sha256", "content_status", "content_error", "content_cache", "created_at", "updated_at",
    }.issubset(user_file_columns)
    assert migration_count == (6,)
