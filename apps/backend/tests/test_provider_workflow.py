import uuid
from unittest.mock import call, patch

import httpx
import pytest
from asterism.core.exceptions import NotFoundException
from asterism.db.base import Base
from asterism.domains.llm.client import LLMClient
from asterism.domains.settings.discovery import (
    OpenAIProviderDiscovery,
    ProviderDiscoveryRequest,
    _limit_response_size,
)
from asterism.domains.settings.provider_types import (
    OPENAI_BASE_URL,
    ModelCapabilitySource,
    ProviderType,
)
from asterism.domains.settings.schemas import Llm, Provider
from asterism.domains.settings.service import (
    bulk_upsert_providers,
    get_app_settings,
    get_draft_model,
    get_model_and_provider,
    upsert_app_setting,
)
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


def _discovery(payload: dict[str, object]) -> OpenAIProviderDiscovery:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    return OpenAIProviderDiscovery(
        http_client_factory=lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            follow_redirects=False,
            event_hooks={"response": [_limit_response_size]},
        )
    )


@pytest.mark.asyncio
async def test_generic_discovery_manual_fallback_save_reload_and_refresh(tmp_path):
    database = tmp_path / "provider-workflow.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    provider_id = uuid.uuid4()
    discovery = _discovery({"data": [{"id": "local-vision-model"}]})
    request = ProviderDiscoveryRequest(
        provider_type=ProviderType.GENERIC_OPENAI,
        base_url="http://localhost:8080/v1/",
        api_key="secret",
        provider_id=provider_id,
    )
    discovered = await discovery.discover(request)
    model = discovered.models[0].model_copy(
        update={
            "context_window": 32_768,
            "supports_vision": False,
            "context_window_source": ModelCapabilitySource.MANUAL,
            "vision_source": ModelCapabilitySource.MANUAL,
        }
    )
    provider = Provider(
        id=provider_id,
        provider_type=ProviderType.GENERIC_OPENAI,
        name="Local",
        base_url="http://localhost:8080/v1/",
        api_key="secret",
        models=[model],
    )

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        await bulk_upsert_providers([provider], session)
        await upsert_app_setting("draft_model_id", str(model.id), session)
        await session.commit()

        reloaded = await get_app_settings(session)
        stored_model = reloaded.llm_providers[0].models[0]
        assert reloaded.draft_model_id == model.id
        assert stored_model.id == model.id
        assert stored_model.is_active is True
        assert stored_model.context_window == 32_768
        assert stored_model.supports_vision is False
        assert stored_model.context_window_source == ModelCapabilitySource.MANUAL
        assert stored_model.vision_source == ModelCapabilitySource.MANUAL

        refreshed = await discovery.discover(request.model_copy(update={"existing_models": [stored_model]}))
        assert refreshed.models[0].id == model.id
        assert refreshed.models[0].context_window == 32_768
        assert refreshed.models[0].supports_vision is False
        assert refreshed.models[0].context_window_source == ModelCapabilitySource.MANUAL
        assert refreshed.models[0].vision_source == ModelCapabilitySource.MANUAL

    await engine.dispose()


@pytest.mark.asyncio
async def test_runtime_lookup_uses_normalized_urls_and_only_active_models(tmp_path):
    database = tmp_path / "runtime-provider.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    openai_id = uuid.uuid4()
    generic_id = uuid.uuid4()
    active_model_id = uuid.uuid4()
    generic_model_id = uuid.uuid4()
    inactive_model_id = uuid.uuid4()
    providers = [
        Provider(
            id=openai_id,
            provider_type=ProviderType.OPENAI,
            name="OpenAI",
            base_url="https://untrusted.example/v1",
            api_key="openai-secret",
            models=[
                Llm(
                    id=active_model_id,
                    provider_id=openai_id,
                    name="gpt-4o",
                    is_active=True,
                )
            ],
        ),
        Provider(
            id=generic_id,
            provider_type=ProviderType.GENERIC_OPENAI,
            name="Local",
            base_url="HTTP://LOCALHOST:8080/v1/",
            api_key="local-secret",
            models=[
                Llm(
                    id=generic_model_id,
                    provider_id=generic_id,
                    name="active-local",
                    is_active=True,
                ),
                Llm(
                    id=inactive_model_id,
                    provider_id=generic_id,
                    name="inactive-local",
                    is_active=False,
                ),
            ],
        ),
    ]

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        await bulk_upsert_providers(providers, session)
        await session.commit()

        active = await get_model_and_provider(active_model_id, session=session)
        assert active.provider.base_url == OPENAI_BASE_URL
        generic = await get_model_and_provider(generic_model_id, session=session)
        assert generic.provider.base_url == "http://localhost:8080/v1"
        with pytest.raises(NotFoundException):
            await get_model_and_provider(inactive_model_id, session=session)

        await upsert_app_setting("draft_model_id", str(active_model_id), session)
        draft = await get_draft_model(session)
        assert draft.id == active_model_id
        assert draft.provider.base_url == OPENAI_BASE_URL

        await upsert_app_setting("draft_model_id", str(inactive_model_id), session)
        with pytest.raises(NotFoundException):
            await get_draft_model(session)

    with patch("asterism.domains.llm.client.AsyncOpenAI") as async_openai:
        for model in (active, generic):
            LLMClient(
                api_key=model.provider.api_key,
                base_url=model.provider.base_url,
                model_name=model.name,
            )
        assert async_openai.call_args_list == [
            call(
                api_key="openai-secret",
                base_url=OPENAI_BASE_URL,
                timeout=120.0,
            ),
            call(
                api_key="local-secret",
                base_url="http://localhost:8080/v1",
                timeout=120.0,
            ),
        ]

    await engine.dispose()
