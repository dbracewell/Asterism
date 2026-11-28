"""US-123.1: the split settings service keeps its public functions, and provider conflicts are clear 409s."""

import uuid

import pytest
import pytest_asyncio
from asterism.core.exceptions import ConflictException
from asterism.db.model_registry import Base
from asterism.domains.knowledge import processing  # noqa: F401  # registers the captioning guard
from asterism.domains.settings import app_settings, providers, service, user_settings
from asterism.domains.settings.provider_types import ProviderType
from asterism.domains.settings.schemas import ProviderSettings, ProviderSummary
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def sessions(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'settings.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def summary(provider_id: uuid.UUID, name: str) -> ProviderSummary:
    return ProviderSummary(
        id=provider_id,
        provider_type=ProviderType.GENERIC_OPENAI,
        name=name,
        base_url="http://localhost:8080/v1",
        api_key="secret",
    )


async def names(session) -> dict[uuid.UUID, str]:
    return {provider.id: provider.name for provider in (await providers.get_provider_settings(session)).llm_providers}


async def test_duplicate_provider_names_are_refused_by_name(sessions):
    async with sessions() as session:
        twice = ProviderSettings(llm_providers=[summary(uuid.uuid4(), "Local"), summary(uuid.uuid4(), "Local")])
        with pytest.raises(ConflictException, match="Two providers are named 'Local'"):
            await service.update_provider_settings(twice, session)
        assert await names(session) == {}

        value = [
            {
                "id": str(uuid.uuid4()),
                "provider_type": "generic_openai",
                "name": "Lab",
                "base_url": "http://a/v1",
                "api_key": "k",
                "models": [],
            },
            {
                "id": str(uuid.uuid4()),
                "provider_type": "generic_openai",
                "name": "Lab",
                "base_url": "http://b/v1",
                "api_key": "k",
                "models": [],
            },
        ]
        with pytest.raises(ConflictException, match="named 'Lab'"):
            await service.upsert_app_setting("llm_providers", value, session)
        assert await names(session) == {}


async def test_a_constraint_failure_is_a_clear_conflict_and_saves_nothing(sessions):
    first, second = uuid.uuid4(), uuid.uuid4()
    async with sessions() as session:
        await service.update_provider_settings(
            ProviderSettings(llm_providers=[summary(first, "Alpha"), summary(second, "Beta")]), session
        )
        # Swapping two names in one save passes the name check but trips the
        # unique index on the first row's update.
        swapped = ProviderSettings(llm_providers=[summary(first, "Beta"), summary(second, "Alpha")])
        with pytest.raises(ConflictException) as refused:
            await service.update_provider_settings(swapped, session)
        assert str(refused.value) == providers.PROVIDER_CONFLICT
    async with sessions() as session:
        assert await names(session) == {first: "Alpha", second: "Beta"}


def test_the_service_module_still_exposes_every_public_function():
    areas = (user_settings, app_settings, providers)
    for name in service.__all__:
        exported = getattr(service, name)
        assert any(getattr(area, name, None) is exported for area in areas) or name == "get_tool_settings", name
    assert {name for name in service.__all__ if not name.startswith("_")} >= {
        "get_app_settings",
        "upsert_app_setting",
        "get_user_settings",
        "upsert_user_setting",
        "get_provider_settings",
        "update_provider_settings",
        "get_model_and_provider",
        "replace_provider_models",
    }
