import uuid
from typing import Any, cast

from pydantic import JsonValue
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

import asterism.domains.agent.service as agent_service
from asterism.common.log import get_logger
from asterism.core.events import EventType, NoArgEvent, event_bus
from asterism.core.exceptions import NotFoundException
from asterism.db.database import get_async_db_session

from .models import (
    ApplicationSettingsModel,
    LLMModel,
    ProviderModel,
    UserSettingModel,
)
from .schemas import (
    ApplicationSettings,
    BulkUpdateSettingRequest,
    Llm,
    LlmDisplayInfo,
    LlmWithProvider,
    Provider,
    Setting,
    UserSettings,
)

logger = get_logger("Settings")


# ------------------------------------------------------------------
# User settings
# ------------------------------------------------------------------


async def get_user_settings(
    user_id: str,
    session: AsyncSession | None = None,
) -> UserSettings:

    # cached = settings_cache.get_user_settings(user_id)
    # if cached:
    #     return cached

    async with get_async_db_session(session) as session:
        stmt = select(UserSettingModel).where(UserSettingModel.user_id == user_id)
        result = await session.scalars(stmt)
        combined: dict[str, Any] = {row.key: row.value for row in result.all()}

        user_settings = UserSettings.model_validate(combined)
        user_settings.models = await get_user_models(
            user_id=user_id,
            session=session,
        )
        user_agents = await agent_service.get_user_agents(
            user_id=user_id,
            session=session,
        )
        user_settings.agents = user_agents.agents
        if user_settings.default_agent_id not in user_agents.agents:
            user_settings.default_agent_id = None

    # settings_cache.set_user_settings(user_id, user_settings)
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

    # settings_cache.remove_user_setting(user_id)
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
        # settings_cache.remove_user_setting(user_id)

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
        # settings_cache.remove_user_setting(user_id)


# ------------------------------------------------------------------
# Application settings
# ------------------------------------------------------------------


async def get_app_settings(
    session: AsyncSession | None = None,
) -> ApplicationSettings:
    async with get_async_db_session(session) as session:
        stmt = select(ApplicationSettingsModel)
        result = await session.scalars(stmt)
        full: dict[str, Any] = {row.key: row.value for row in result.all()}

        if "active_tools" not in full:
            full["active_tools"] = []

        new_setting = ApplicationSettings.model_validate(full)
        providers = await get_all_providers(session)
        new_setting.llm_providers = [Provider.model_validate(p) for p in providers]

        return new_setting


async def upsert_app_setting(
    key: str,
    value: JsonValue,
    session: AsyncSession | None = None,
) -> Setting:
    if value is None:
        await delete_app_setting(key, session)
        return Setting(key=key, value=value)

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

        if draft_model_updated:
            event_bus.emit(NoArgEvent(type=EventType.DRAFT_MODEL_UPDATED))

        return Setting(key=key, value=value)


async def delete_app_setting(
    key: str,
    session: AsyncSession | None = None,
) -> None:
    async with get_async_db_session(session) as session:
        stmt = delete(ApplicationSettingsModel).where(
            ApplicationSettingsModel.key == key
        )
        await session.execute(stmt)
        await session.commit()


async def bulk_update_app_setting(
    updates: BulkUpdateSettingRequest,
    session: AsyncSession | None = None,
) -> ApplicationSettings:
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

    app_settings = await get_app_settings(session)

    if draft_model_updated:
        """Send a signal that the draft model has been updated"""
        event_bus.emit(NoArgEvent(type=EventType.DRAFT_MODEL_UPDATED))

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
                    context_window=m.context_window,
                    supports_vision=m.supports_vision,
                    context_window_source=m.context_window_source,
                    vision_source=m.vision_source,
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
            existing_provider.provider_type = provider.provider_type
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
                provider_type=provider.provider_type,
                name=provider.name,
                base_url=provider.base_url,
                api_key=provider.api_key,
                models=[
                    LLMModel(
                        id=m.id,
                        name=m.name,
                        is_active=m.is_active,
                        context_window=m.context_window,
                        supports_vision=m.supports_vision,
                        context_window_source=m.context_window_source,
                        vision_source=m.vision_source,
                    )
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
            existing_model.context_window = m_data.context_window
            existing_model.supports_vision = m_data.supports_vision
            existing_model.context_window_source = m_data.context_window_source
            existing_model.vision_source = m_data.vision_source
            synced_models.append(existing_model)
        else:
            new_model = LLMModel(
                id=m_data.id,
                name=m_data.name,
                is_active=m_data.is_active,
                context_window=m_data.context_window,
                supports_vision=m_data.supports_vision,
                context_window_source=m_data.context_window_source,
                vision_source=m_data.vision_source,
            )
            synced_models.append(new_model)
    return synced_models
