import uuid
from typing import Any, cast

from cachetools import TTLCache
from pydantic import JsonValue
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from asterism.common.concurrency import AsyncAtomic
from asterism.common.log import get_logger
from asterism.core.events import Event, EventType, event_bus
from asterism.core.exceptions import NotFoundException, UnauthorizedException
from asterism.db.database import get_async_db_session

from .models import (
    AgentProfileModel,
    ApplicationSettingsModel,
    LLMModel,
    ProviderModel,
    UserSettingModel,
)
from .schemas import (
    AgentProfile,
    ApplicationSettings,
    BulkUpdateSettingRequest,
    Llm,
    LlmDisplayInfo,
    LlmWithProvider,
    PartialAgentProfile,
    Provider,
    Setting,
    UserAgents,
    UserSettings,
)

logger = get_logger("Settings")


_user_cache: TTLCache[str, UserSettings] = TTLCache[str, UserSettings](
    maxsize=100, ttl=3600
)
_app_cache = AsyncAtomic[ApplicationSettings | None](None)


# ------------------------------------------------------------------
# User settings
# ------------------------------------------------------------------


async def get_user_settings(
    user_id: str,
    session: AsyncSession | None = None,
) -> UserSettings:

    cached = _user_cache.get(user_id)
    if cached:
        return cached

    async with get_async_db_session(session) as session:
        stmt = select(UserSettingModel).where(UserSettingModel.user_id == user_id)
        result = await session.scalars(stmt)
        combined: dict[str, Any] = {row.key: row.value for row in result.all()}

        user_settings = UserSettings.model_validate(combined)
        user_settings.models = await get_user_models(
            user_id=user_id,
            session=session,
        )
        user_agents = await get_user_agents(
            user_id=user_id,
            session=session,
        )
        user_settings.agents = user_agents.agents

    _user_cache[user_id] = user_settings
    return user_settings


async def bulk_upsert_user_settings(
    user_id: str,
    updates: dict[str, Any],
    session: AsyncSession | None = None,
) -> UserSettings:
    async with get_async_db_session(session) as session:
        for key, value in updates.items():
            if value is None:
                stmt = delete(UserSettingModel).where(
                    UserSettingModel.user_id == user_id,
                    UserSettingModel.key == key,
                )
            else:
                stmt = (
                    insert(UserSettingModel)
                    .values(
                        {
                            "user_id": user_id,
                            "value": value,
                            "key": key,
                        }
                    )
                    .on_conflict_do_update(
                        index_elements=["user_id", "key"],
                        set_={
                            "value": value,
                        },
                    )
                )

            await session.execute(stmt)

        await session.commit()

    _user_cache.pop(user_id, None)
    return await get_user_settings(user_id, session)


async def upsert_user_setting(
    user_id: str,
    key: str,
    value: JsonValue,
    session: AsyncSession | None = None,
) -> Setting:

    if value is None:
        await delete_user_setting(user_id, key, session)
        return Setting(key=key, value=value)

    async with get_async_db_session(session) as session:
        stmt = (
            insert(UserSettingModel)
            .values(
                {
                    "user_id": user_id,
                    "value": value,
                    "key": key,
                }
            )
            .on_conflict_do_update(
                index_elements=["user_id", "key"],
                set_={
                    "value": value,
                },
            )
        )
        await session.execute(stmt)
        await session.commit()
        _user_cache.pop(user_id, None)

        return Setting(key=key, value=value)


async def delete_user_setting(
    user_id: str,
    key: str,
    session: AsyncSession | None = None,
) -> None:
    async with get_async_db_session(session) as session:
        stmt = delete(UserSettingModel).where(
            UserSettingModel.user_id == user_id,
            UserSettingModel.key == key,
        )
        await session.execute(stmt)
        await session.commit()
        _user_cache.pop(user_id, None)


# ------------------------------------------------------------------
# Application settings
# ------------------------------------------------------------------


async def get_app_settings(
    session: AsyncSession | None = None,
) -> ApplicationSettings:
    async with _app_cache as (get, set):
        cached = get()
        if cached:
            return cached

        async with get_async_db_session(session) as session:
            stmt = select(ApplicationSettingsModel)
            result = await session.scalars(stmt)
            full: dict[str, Any] = {row.key: row.value for row in result.all()}

            new_setting = ApplicationSettings.model_validate(full)
            providers = await get_all_providers(session)
            new_setting.llm_providers = [Provider.model_validate(p) for p in providers]

            set(new_setting)
            return new_setting


async def upsert_app_setting(
    key: str,
    value: JsonValue,
    session: AsyncSession | None = None,
) -> Setting:
    if value is None:
        await delete_app_setting(key, session)
        return Setting(key=key, value=value)

    async with _app_cache as (_, set):
        set(None)

        async with get_async_db_session(session) as session:
            draft_model_updated = False

            if key == "llm_providers":
                llm_providers = [Provider(**d) for d in cast(list, value) or []]
                await bulk_upsert_providers(
                    llm_providers,
                    session=session,
                )
                return Setting(key=key, value=value)

            if key == "draft_model_id":
                draft_model_updated = True

            stmt = (
                insert(ApplicationSettingsModel)
                .values(
                    {
                        "value": value,
                        "key": key,
                    }
                )
                .on_conflict_do_update(
                    index_elements=["key"],
                    set_={
                        "value": value,
                    },
                )
            )
            await session.execute(stmt)
            await session.commit()
            _user_cache.clear()

            if draft_model_updated:
                event_bus.emit(Event(type=EventType.DRAFT_MODEL_UPDATED))

            return Setting(key=key, value=value)


async def delete_app_setting(
    key: str,
    session: AsyncSession | None = None,
) -> None:
    async with _app_cache as (_, set):
        async with get_async_db_session(session) as session:
            stmt = delete(ApplicationSettingsModel).where(
                ApplicationSettingsModel.key == key
            )
            await session.execute(stmt)
            await session.commit()
            set(None)
            _user_cache.clear()


async def bulk_update_app_setting(
    updates: BulkUpdateSettingRequest,
    session: AsyncSession | None = None,
) -> ApplicationSettings:
    async with _app_cache as (_, set):
        async with get_async_db_session(session) as session:
            draft_model_updated = False

            for key, value in updates.values.items():
                # Special case that the llm providers are being updated
                if key == "llm_providers":
                    llm_providers = [Provider(**d) for d in cast(list, value) or []]
                    await bulk_upsert_providers(
                        llm_providers,
                        session=session,
                    )
                    continue

                if key == "draft_model_id":
                    draft_model_updated = True

                stmt = (
                    insert(ApplicationSettingsModel)
                    .values(
                        {
                            "value": value,
                            "key": key,
                        }
                    )
                    .on_conflict_do_update(
                        index_elements=["key"],
                        set_={
                            "value": value,
                        },
                    )
                )
                await session.execute(stmt)

            await session.commit()
            _user_cache.clear()
            set(None)

    app_settings = await get_app_settings(session)

    if draft_model_updated:
        """Send a signal that the draft model has been updated"""
        event_bus.emit(Event(type=EventType.DRAFT_MODEL_UPDATED))

    return app_settings


# ------------------------------------------------------------------
# Provider & Model settings
# ------------------------------------------------------------------


async def get_draft_model(
    session: AsyncSession | None = None,
) -> LlmWithProvider:
    async with get_async_db_session(session) as session:
        stmt = select(ApplicationSettingsModel.value).where(
            ApplicationSettingsModel.key == "draft_model_id"
        )

        value = await session.scalar(stmt)
        if not value:
            raise NotFoundException("Draft model not set in application settings")

        draft_model_id = uuid.UUID(cast(str, value))

        stmt = (
            select(LLMModel)
            .options(joinedload(LLMModel.provider))
            .where(LLMModel.id == draft_model_id)
        )

        result = await session.scalar(stmt)
        if not result:
            raise NotFoundException(f"Model id {draft_model_id} not found in database")

        return LlmWithProvider.model_validate(result)


async def get_all_providers(session: AsyncSession) -> list[ProviderModel]:
    async with get_async_db_session(session) as session:
        stmt = select(ProviderModel).options(
            selectinload(ProviderModel.models),
        )
        result = await session.scalars(stmt)
        return list(result.all())


async def get_user_models(
    user_id: str,
    session: AsyncSession | None = None,
) -> list[LlmDisplayInfo]:
    async with get_async_db_session(session) as session:
        stmt = (
            select(LLMModel)
            .where(LLMModel.is_active)
            .options(joinedload(LLMModel.provider))
        )
        result = await session.scalars(stmt)
        models: list[LlmDisplayInfo] = []
        for m in result.all():
            models.append(
                LlmDisplayInfo(
                    id=m.id,
                    name=m.name,
                    provider_id=m.provider.id,
                    provider_name=m.provider.name,
                )
            )
        return models


async def get_model_and_provider(
    model_id: uuid.UUID,
    user_id: str | None = None,
    session: AsyncSession | None = None,
) -> LlmWithProvider:
    async with get_async_db_session(session) as session:
        stmt = (
            select(LLMModel)
            .where(
                LLMModel.id == model_id,
                LLMModel.is_active,
            )
            .options(joinedload(LLMModel.provider))
        )
        result = await session.scalar(stmt)
        if not result:
            raise NotFoundException(f"Model id {model_id} not found in database")

        return LlmWithProvider.model_validate(result)


async def get_model(
    model_id: uuid.UUID,
    user_id: str | None = None,
    session: AsyncSession | None = None,
) -> Llm:
    async with get_async_db_session(session) as session:
        stmt = select(LLMModel).where(
            LLMModel.id == model_id,
            LLMModel.is_active,
        )
        result = await session.scalar(stmt)
        if not result:
            raise NotFoundException(f"Model id {model_id} not found in database")
        return Llm.model_validate(result)


async def bulk_upsert_providers(
    update: list[Provider],
    session: AsyncSession,
):
    current_providers = await get_all_providers(session=session)
    processed_providers = set()
    existing_providers = {p.id: p for p in current_providers}

    for provider in update:
        existing_provider = existing_providers.get(provider.id, None)

        if existing_provider:
            processed_providers.add(provider.id)
            existing_provider.base_url = provider.base_url
            existing_provider.api_key = provider.api_key
            existing_provider.name = provider.name
            existing_provider.models = _merge_models(
                provider.models,
                existing_provider.models,
            )
            await session.flush()
        else:
            processed_providers.add(provider.id)
            new_provider = ProviderModel(
                id=provider.id,
                name=provider.name,
                base_url=provider.base_url,
                api_key=provider.api_key,
                models=[
                    LLMModel(id=m.id, name=m.name, is_active=m.is_active)
                    for m in provider.models
                ],
            )
            session.add(new_provider)
            await session.flush()

    for delete_id in set(existing_providers.keys()).difference(processed_providers):
        await session.execute(
            delete(ProviderModel).where(ProviderModel.id == delete_id)
        )


def _merge_models(
    new_models: list[Llm],
    existing: list[LLMModel],
):
    existing_models_by_name = {m.name: m for m in existing}
    synced_models: list[LLMModel] = []
    for m_data in new_models:
        if m_data.name in existing_models_by_name:
            existing_model = existing_models_by_name[m_data.name]
            existing_model.is_active = m_data.is_active
            synced_models.append(existing_model)
        else:
            new_model = LLMModel(
                name=m_data.name,
                is_active=m_data.is_active,
            )
            synced_models.append(new_model)
    return synced_models


async def get_user_agents(
    user_id: str,
    session: AsyncSession | None = None,
) -> UserAgents:
    async with get_async_db_session(session) as session:
        stmt = select(AgentProfileModel).where(AgentProfileModel.user_id == user_id)
        results = await session.scalars(stmt)

        agents_dict: dict[uuid.UUID, AgentProfile] = {}
        for r in results:
            agents_dict[r.id] = AgentProfile.model_validate(r)

        return UserAgents(agents=agents_dict)


async def get_agent_profile(
    user_id: str,
    agent_id: uuid.UUID,
    session: AsyncSession | None = None,
) -> AgentProfile:
    async with get_async_db_session(session) as session:
        result = await session.get(AgentProfileModel, agent_id)
        if not result:
            raise NotFoundException(f"Agent with id {agent_id} not found")
        if user_id != result.user_id:
            raise UnauthorizedException()
        return AgentProfile.model_validate(result)


async def upsert_agent_profile(
    agent_profile: PartialAgentProfile,
    session: AsyncSession | None = None,
) -> AgentProfile:
    async with get_async_db_session(session) as session:
        if agent_profile.id:
            result = await session.get(AgentProfileModel, agent_profile.id)
            if not result:
                raise NotFoundException(f"Agent with id {agent_profile.id} not found")
            if agent_profile.user_id != result.user_id:
                raise UnauthorizedException()
            result.chat_parameters = agent_profile.chat_parameters
            result.description = agent_profile.description
            result.name = agent_profile.name
            result.model_id = agent_profile.model_id
            result.max_steps = agent_profile.max_steps
            result.system_prompt = agent_profile.system_prompt
            result.tools = agent_profile.tools
            await session.commit()
            return AgentProfile.model_validate(result)

        new_profile = AgentProfileModel(**agent_profile.model_dump())
        session.add(new_profile)
        await session.commit()
        await session.refresh(new_profile)
        return AgentProfile.model_validate(new_profile)
