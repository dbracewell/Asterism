import sqlite3
import uuid

import pytest
from asterism.core import config
from asterism.core.exceptions import BadDataException
from asterism.db.base import Base
from asterism.db.init_db import initialize_database
from asterism.domains.knowledge.schemas import KnowledgeCaptionConfigurationUpdate
from asterism.domains.knowledge.service import update_captioning_configuration
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.provider_types import (
    OPENAI_BASE_URL,
    ModelCapabilitySource,
    ProviderType,
)
from asterism.domains.settings.schemas import (
    BulkUpdateSettingRequest,
    ComponentProviderParameters,
    Llm,
    Provider,
    ProviderSettings,
    ProviderSummary,
    ToolSettings,
)
from asterism.domains.settings.service import (
    bulk_update_app_setting,
    bulk_upsert_providers,
    get_all_providers,
    get_app_settings,
    get_provider_settings,
    get_tool_settings,
    update_provider_settings,
    update_tool_settings,
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


@pytest.mark.asyncio
async def test_focused_provider_and_tool_settings_preserve_owned_values(tmp_path):
    database = tmp_path / "focused-settings.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    provider_id = uuid.uuid4()
    model_id = uuid.uuid4()
    provider = Provider(
        id=provider_id,
        provider_type=ProviderType.GENERIC_OPENAI,
        name="Local",
        base_url="http://localhost:8080/v1",
        api_key="secret",
        models=[
            Llm(
                id=model_id,
                provider_id=provider_id,
                name="local-model",
                is_active=True,
            )
        ],
    )

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        await bulk_upsert_providers([provider], session)
        session.add_all(
            [
                ApplicationSettingsModel(key="draft_model_id", value=str(model_id)),
                ApplicationSettingsModel(key="active_tools", value=["web_search"]),
                ApplicationSettingsModel(
                    key="web_search_provider",
                    value={"name": "SearXNG", "parameters": {"base_url": "http://search"}},
                ),
                ApplicationSettingsModel(
                    key="image_search_provider",
                    value={"name": "Tavily", "parameters": {"api_key": "secret"}},
                ),
            ]
        )
        await session.commit()

        provider_settings = await get_provider_settings(session)
        assert provider_settings.draft_model_id == model_id
        assert provider_settings.llm_providers == [
            ProviderSummary(
                id=provider_id,
                provider_type=ProviderType.GENERIC_OPENAI,
                name="Local",
                base_url="http://localhost:8080/v1",
                api_key="secret",
                model_count=1,
                active_model_count=1,
            )
        ]
        assert provider_settings.draft_model is not None
        assert provider_settings.draft_model.provider_id == provider_id

        tool_settings = await get_tool_settings(session)
        assert tool_settings.active_tools == ["web_search"]
        assert tool_settings.web_search_provider == ComponentProviderParameters(
            name="SearXNG",
            parameters={"base_url": "http://search"},
        )
        assert tool_settings.image_search_provider == ComponentProviderParameters(
            name="Tavily",
            parameters={"api_key": "secret"},
        )

    await engine.dispose()


@pytest.mark.asyncio
async def test_focused_settings_return_defaults_for_empty_database(tmp_path):
    database = tmp_path / "empty-focused-settings.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        provider_settings = await get_provider_settings(session)
        tool_settings = await get_tool_settings(session)

        assert provider_settings.llm_providers == []
        assert provider_settings.draft_model_id is None
        assert tool_settings.active_tools == []
        assert tool_settings.web_search_provider is None
        assert tool_settings.image_search_provider is None

    await engine.dispose()


@pytest.mark.asyncio
async def test_focused_settings_writes_return_the_persisted_resources(tmp_path):
    database = tmp_path / "focused-settings-write.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    provider_id = uuid.uuid4()
    provider_settings = ProviderSettings(
        llm_providers=[
            ProviderSummary(
                id=provider_id,
                provider_type=ProviderType.GENERIC_OPENAI,
                name="Local",
                base_url="http://localhost:8080/v1",
                api_key="secret",
            )
        ],
        draft_model_id=None,
    )
    tool_settings = ToolSettings(
        active_tools=["web_search"],
        web_search_provider=ComponentProviderParameters(
            name="SearXNG",
            parameters={"base_url": "http://search"},
        ),
    )

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        persisted_provider_settings = await update_provider_settings(provider_settings, session)
        assert persisted_provider_settings.llm_providers[0].name == "Local"
        assert persisted_provider_settings.llm_providers[0].model_count == 0

        # API keys are redacted in JSON responses. Submitting that redacted
        # value while removing another provider must retain the stored key.
        redacted_update = ProviderSettings.model_validate(
            provider_settings.model_dump(mode="json"),
        )
        persisted_provider_settings = await update_provider_settings(
            redacted_update,
            session,
        )
        assert (
            persisted_provider_settings.llm_providers[0]
            .api_key.get_secret_value()
            == "secret"
        )
        assert await update_tool_settings(tool_settings, session) == tool_settings

        assert await get_provider_settings(session) == provider_settings
        assert await get_tool_settings(session) == tool_settings

    await engine.dispose()


@pytest.mark.asyncio
async def test_removing_a_provider_clears_its_draft_model(tmp_path):
    database = tmp_path / "remove-draft-provider.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    provider_id = uuid.uuid4()
    model_id = uuid.uuid4()
    provider = Provider(
        id=provider_id,
        provider_type=ProviderType.GENERIC_OPENAI,
        name="Local",
        base_url="http://localhost:8080/v1",
        api_key="secret",
        models=[
            Llm(
                id=model_id,
                provider_id=provider_id,
                name="local-model",
                is_active=True,
            )
        ],
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        await bulk_upsert_providers([provider], session)
        session.add(ApplicationSettingsModel(key="draft_model_id", value=str(model_id)))
        await session.commit()

        removal = (await get_provider_settings(session)).model_copy(
            update={"llm_providers": []},
        )
        persisted = await update_provider_settings(removal, session)

        assert persisted.llm_providers == []
        assert persisted.draft_model_id is None
        assert persisted.draft_model is None

    await engine.dispose()


@pytest.mark.asyncio
async def test_removing_the_selected_captioning_provider_is_rejected(tmp_path):
    database = tmp_path / "selected-caption-provider.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    provider_id = uuid.uuid4()
    model_id = uuid.uuid4()
    provider = Provider(
        id=provider_id,
        provider_type=ProviderType.GENERIC_OPENAI,
        name="Vision",
        base_url="http://localhost:8080/v1",
        api_key="secret",
        models=[
            Llm(
                id=model_id,
                provider_id=provider_id,
                name="vision-model",
                is_active=True,
                supports_vision=True,
                vision_source=ModelCapabilitySource.MANUAL,
            )
        ],
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        await bulk_upsert_providers([provider], session)
        await session.commit()
        await update_captioning_configuration(
            payload=KnowledgeCaptionConfigurationUpdate(mode="provider", provider_model_id=model_id),
            session=session,
        )

        with pytest.raises(BadDataException, match="selected for image captioning"):
            await update_provider_settings(ProviderSettings(llm_providers=[]), session)
        await session.rollback()

        assert (await get_provider_settings(session)).llm_providers[0].id == provider_id

    await engine.dispose()


@pytest.mark.asyncio
async def test_initialization_creates_current_schema_and_is_repeatable(tmp_path, monkeypatch):
    database = tmp_path / "fresh.db"
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
        search_tables = {
            row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('chat_search', 'folder_search')"
            )
        }
        migration_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'asterism_schema_migrations'"
        ).fetchone()
        stored_tools = connection.execute(
            "SELECT value FROM app_settings WHERE key = 'active_tools'"
        ).fetchone()
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO providers (id, provider_type, name, base_url, api_key, created_at, updated_at) "
                "VALUES (?, 'unsupported', 'Bad', 'https://example.test', 'key', 1, 1)",
                (uuid.uuid4().hex,),
            )

    assert "provider_type" in provider_columns
    assert {
        "context_window",
        "supports_vision",
        "context_window_source",
        "vision_source",
    }.issubset(model_columns)
    assert search_tables == {"chat_search", "folder_search"}
    assert migration_table is None
    assert stored_tools is not None
    assert {
        "id", "user_id", "filename", "original_name", "size", "mime_type", "kind",
        "sha256", "content_status", "content_error", "content_cache", "created_at", "updated_at",
    }.issubset(user_file_columns)
