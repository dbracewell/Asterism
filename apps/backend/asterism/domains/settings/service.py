import uuid
from typing import Any, cast

from pydantic import JsonValue
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, noload, selectinload

import asterism.domains.agent.service as agent_service
from asterism.common.log import get_logger
from asterism.core.events import EventType, NoArgEvent, event_bus
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.models import AgentProfileModel

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
    ProviderModelsPage,
    ProviderModelUpdate,
    ProviderSettings,
    ProviderSummary,
    Setting,
    ToolSettings,
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

        # Settings are user-editable key/value rows. Normalize legacy or
        # malformed defaults before validating the aggregate response.
        user_agents = await agent_service.get_user_agents(
            user_id=user_id,
            session=session,
        )
        default_agent_id = _parse_default_agent_id(combined.get("default_agent_id"))
        if default_agent_id is None:
            combined.pop("default_agent_id", None)
        else:
            default_agent = user_agents.agents.get(default_agent_id)
            if default_agent is None or default_agent.sub_agent:
                combined.pop("default_agent_id", None)

        user_settings = UserSettings.model_validate(combined)
        user_settings.models = await get_user_models(
            user_id=user_id,
            session=session,
        )
        user_settings.agents = user_agents.agents

    # settings_cache.set_user_settings(user_id, user_settings)
    return user_settings


async def bulk_upsert_user_settings(
    user_id: str,
    updates: dict[str, Any],
    session: AsyncSession | None = None,
) -> UserSettings:
    async with get_async_db_session(session) as session:
        if "default_agent_id" in updates:
            await _validate_default_main_agent(
                user_id,
                updates["default_agent_id"],
                session,
            )

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
        if key == "default_agent_id":
            await _validate_default_main_agent(user_id, value, session)
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


def _parse_default_agent_id(value: Any) -> uuid.UUID | None:
    if isinstance(value, uuid.UUID):
        return value
    if not isinstance(value, str):
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


async def _validate_default_main_agent(
    user_id: str,
    value: Any,
    session: AsyncSession,
) -> None:
    agent_id = _parse_default_agent_id(value)
    if agent_id is None:
        raise BadDataException("default_agent_id must be a main agent UUID")

    agent = await session.get(AgentProfileModel, agent_id)
    if agent is None or agent.user_id != user_id:
        raise BadDataException("default_agent_id must reference one of your main agents")
    if agent.sub_agent:
        raise BadDataException("A sub-agent cannot be the default agent")


# ------------------------------------------------------------------
# Application settings
# ------------------------------------------------------------------


_TOOL_SETTINGS_KEYS = (
    "active_tools",
    "web_search_provider",
    "image_search_provider",
)


async def get_provider_settings(
    session: AsyncSession | None = None,
) -> ProviderSettings:
    async with get_async_db_session(session) as session:
        model_count = (
            select(func.count(LLMModel.id))
            .where(LLMModel.provider_id == ProviderModel.id)
            .scalar_subquery()
        )
        active_model_count = (
            select(func.count(LLMModel.id))
            .where(LLMModel.provider_id == ProviderModel.id, LLMModel.is_active)
            .scalar_subquery()
        )
        providers_stmt = select(
            ProviderModel,
            model_count.label("model_count"),
            active_model_count.label("active_model_count"),
        ).options(noload(ProviderModel.models))
        providers = list((await session.execute(providers_stmt)).all())
        draft_model_id = await session.scalar(
            select(ApplicationSettingsModel.value).where(
                ApplicationSettingsModel.key == "draft_model_id",
            )
        )

        draft_model = None
        if draft_model_id:
            try:
                parsed_draft_model_id = uuid.UUID(str(draft_model_id))
            except (TypeError, ValueError):
                parsed_draft_model_id = None
            draft_row = await session.scalar(
                select(LLMModel)
                .where(LLMModel.id == parsed_draft_model_id)
                .options(joinedload(LLMModel.provider))
            ) if parsed_draft_model_id is not None else None
            if draft_row is not None:
                draft_model = LlmDisplayInfo(
                    id=draft_row.id,
                    name=draft_row.name,
                    provider_id=draft_row.provider_id,
                    provider_name=draft_row.provider.name,
                    context_window=draft_row.context_window,
                    supports_vision=draft_row.supports_vision,
                    context_window_source=draft_row.context_window_source,
                    vision_source=draft_row.vision_source,
                )

        return ProviderSettings(
            llm_providers=[
                ProviderSummary(
                    id=provider.id,
                    name=provider.name,
                    base_url=provider.base_url,
                    api_key=provider.api_key,
                    provider_type=provider.provider_type,
                    model_count=count,
                    active_model_count=active_count,
                )
                for provider, count, active_count in providers
            ],
            draft_model_id=None if draft_model_id == "" else draft_model_id,
            draft_model=draft_model,
        )


async def get_tool_settings(
    session: AsyncSession | None = None,
) -> ToolSettings:
    async with get_async_db_session(session) as session:
        stmt = select(ApplicationSettingsModel).where(
            ApplicationSettingsModel.key.in_(_TOOL_SETTINGS_KEYS),
        )
        settings = {row.key: row.value for row in (await session.scalars(stmt)).all()}
        return ToolSettings.model_validate(settings)


async def update_provider_settings(
    settings: ProviderSettings,
    session: AsyncSession | None = None,
) -> ProviderSettings:
    async with get_async_db_session(session) as session:
        existing_providers = {
            provider.id: provider
            for provider in (
                await session.scalars(select(ProviderModel).options(noload(ProviderModel.models)))
            ).all()
        }
        incoming_ids = {provider.id for provider in settings.llm_providers}
        for deleted_id in set(existing_providers).difference(incoming_ids):
            await session.execute(delete(ProviderModel).where(ProviderModel.id == deleted_id))

        for provider in settings.llm_providers:
            existing = existing_providers.get(provider.id)
            if existing is None:
                session.add(
                    ProviderModel(
                        id=provider.id,
                        provider_type=provider.provider_type,
                        name=provider.name,
                        base_url=provider.base_url,
                        api_key=provider.api_key,
                    )
                )
            else:
                existing.provider_type = provider.provider_type
                existing.name = provider.name
                existing.base_url = provider.base_url
                existing.api_key = provider.api_key

        if settings.draft_model_id is not None:
            draft_model = await session.scalar(
                select(LLMModel).where(
                    LLMModel.id == settings.draft_model_id,
                    LLMModel.is_active,
                )
            )
            if draft_model is None:
                raise BadDataException("draft_model_id must reference an active model")
        stmt = (
            insert(ApplicationSettingsModel)
            .values(
                {
                    "key": "draft_model_id",
                    "value": str(settings.draft_model_id) if settings.draft_model_id else None,
                }
            )
            .on_conflict_do_update(
                index_elements=["key"],
                set_={"value": str(settings.draft_model_id) if settings.draft_model_id else None},
            )
        )
        await session.execute(stmt)
        await session.commit()

    event_bus.emit(NoArgEvent(type=EventType.DRAFT_MODEL_UPDATED))
    return await get_provider_settings(session)


async def get_provider_models(
    provider_id: uuid.UUID,
    query: str = "",
    cursor: uuid.UUID | None = None,
    limit: int = 50,
    session: AsyncSession | None = None,
) -> ProviderModelsPage:
    async with get_async_db_session(session) as session:
        exists = await session.scalar(
            select(ProviderModel.id).where(ProviderModel.id == provider_id)
        )
        if exists is None:
            raise NotFoundException(f"Provider id {provider_id} not found in database")

        normalized_name = func.lower(LLMModel.name)
        base_filters = [LLMModel.provider_id == provider_id]
        if query.strip():
            escaped_query = query.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            base_filters.append(normalized_name.like(f"%{escaped_query}%", escape="\\"))

        filters = [*base_filters]

        if cursor is not None:
            cursor_model = await session.scalar(
                select(LLMModel).where(
                    LLMModel.id == cursor,
                    LLMModel.provider_id == provider_id,
                )
            )
            if cursor_model is None:
                raise BadDataException("cursor must reference a model in this provider")
            cursor_name = cursor_model.name.lower()
            filters.append(
                or_(
                    normalized_name > cursor_name,
                    and_(normalized_name == cursor_name, LLMModel.id > cursor),
                )
            )

        rows = list(
            (
                await session.scalars(
                    select(LLMModel)
                    .where(*filters)
                    .order_by(normalized_name, LLMModel.id)
                    .limit(limit + 1)
                )
            ).all()
        )
        page_models = rows[:limit]
        total = await session.scalar(select(func.count(LLMModel.id)).where(*base_filters))
        return ProviderModelsPage(
            models=[Llm.model_validate(model) for model in page_models],
            next_cursor=str(rows[limit].id) if len(rows) > limit else None,
            total=total or 0,
        )


async def update_provider_model(
    provider_id: uuid.UUID,
    model_id: uuid.UUID,
    update: ProviderModelUpdate,
    session: AsyncSession | None = None,
) -> Llm:
    async with get_async_db_session(session) as session:
        model = await session.scalar(
            select(LLMModel).where(
                LLMModel.id == model_id,
                LLMModel.provider_id == provider_id,
            )
        )
        if model is None:
            raise NotFoundException(f"Model id {model_id} not found in provider")

        model.is_active = update.is_active
        model.context_window = update.context_window
        model.supports_vision = update.supports_vision
        model.context_window_source = update.context_window_source
        model.vision_source = update.vision_source
        await session.flush()

        draft_model_id = await session.scalar(
            select(ApplicationSettingsModel.value).where(
                ApplicationSettingsModel.key == "draft_model_id",
            )
        )
        if not model.is_active and str(model.id) == str(draft_model_id):
            replacement = await session.scalar(
                select(LLMModel.id)
                .where(LLMModel.is_active)
                .order_by(func.lower(LLMModel.name), LLMModel.id)
                .limit(1)
            )
            await session.execute(
                insert(ApplicationSettingsModel)
                .values({"key": "draft_model_id", "value": str(replacement) if replacement else None})
                .on_conflict_do_update(
                    index_elements=["key"],
                    set_={"value": str(replacement) if replacement else None},
                )
            )
        await session.commit()
        result = Llm.model_validate(model)

    event_bus.emit(NoArgEvent(type=EventType.DRAFT_MODEL_UPDATED))
    return result


async def get_provider_for_discovery(
    provider_id: uuid.UUID,
    session: AsyncSession | None = None,
) -> Provider:
    async with get_async_db_session(session) as session:
        provider = await session.scalar(
            select(ProviderModel)
            .where(ProviderModel.id == provider_id)
            .options(selectinload(ProviderModel.models))
        )
        if provider is None:
            raise NotFoundException(f"Provider id {provider_id} not found in database")
        return Provider.model_validate(provider)


async def replace_provider_models(
    provider_id: uuid.UUID,
    models: list[Llm],
    session: AsyncSession | None = None,
) -> ProviderSummary:
    async with get_async_db_session(session) as session:
        provider = await session.scalar(
            select(ProviderModel)
            .where(ProviderModel.id == provider_id)
            .options(selectinload(ProviderModel.models))
        )
        if provider is None:
            raise NotFoundException(f"Provider id {provider_id} not found in database")
        provider.models = _merge_models(models, provider.models)
        await session.commit()

    settings = await get_provider_settings(session)
    summary = next((item for item in settings.llm_providers if item.id == provider_id), None)
    if summary is None:
        raise NotFoundException(f"Provider id {provider_id} not found in database")
    return summary


async def get_captioning_models(
    session: AsyncSession | None = None,
) -> list[LlmDisplayInfo]:
    async with get_async_db_session(session) as session:
        rows = list(
            (
                await session.scalars(
                    select(LLMModel)
                    .where(
                        LLMModel.is_active,
                        LLMModel.supports_vision,
                        LLMModel.vision_source.in_(("catalog", "provider")),
                    )
                    .options(joinedload(LLMModel.provider))
                    .order_by(func.lower(LLMModel.name), LLMModel.id)
                )
            ).all()
        )
        return [
            LlmDisplayInfo(
                id=model.id,
                name=model.name,
                provider_id=model.provider_id,
                provider_name=model.provider.name,
                context_window=model.context_window,
                supports_vision=model.supports_vision,
                context_window_source=model.context_window_source,
                vision_source=model.vision_source,
            )
            for model in rows
        ]


async def update_tool_settings(
    settings: ToolSettings,
    session: AsyncSession | None = None,
) -> ToolSettings:
    values = {
        "active_tools": settings.active_tools,
        "web_search_provider": settings.web_search_provider.model_dump()
        if settings.web_search_provider
        else None,
        "image_search_provider": settings.image_search_provider.model_dump()
        if settings.image_search_provider
        else None,
    }
    async with get_async_db_session(session) as session:
        for key, value in values.items():
            stmt = (
                insert(ApplicationSettingsModel)
                .values({"key": key, "value": value})
                .on_conflict_do_update(
                    index_elements=["key"],
                    set_={"value": value},
                )
            )
            await session.execute(stmt)
        await session.commit()

    return await get_tool_settings(session)


async def get_app_settings(
    session: AsyncSession | None = None,
) -> ApplicationSettings:
    async with get_async_db_session(session) as session:
        stmt = select(ApplicationSettingsModel)
        result = await session.scalars(stmt)
        full: dict[str, Any] = {row.key: row.value for row in result.all()}

        if "active_tools" not in full:
            full["active_tools"] = []
        if full.get("draft_model_id") == "":
            # Recover settings written by older clients that represented an
            # unselected draft model as an empty form value.
            full["draft_model_id"] = None

        new_setting = ApplicationSettings.model_validate(full)
        providers = await get_all_providers(session)
        new_setting.llm_providers = [Provider.model_validate(p) for p in providers]

        return new_setting


async def upsert_app_setting(
    key: str,
    value: JsonValue,
    session: AsyncSession | None = None,
) -> Setting:
    if key == "draft_model_id" and value == "":
        value = None
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
        stmt = delete(ApplicationSettingsModel).where(ApplicationSettingsModel.key == key)
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
                if value == "":
                    value = None

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
        stmt = select(ApplicationSettingsModel.value).where(ApplicationSettingsModel.key == "draft_model_id")

        value = await session.scalar(stmt)
        if not value:
            raise NotFoundException("Draft model not set in application settings")

        draft_model_id = uuid.UUID(cast(str, value))

        stmt = (
            select(LLMModel)
            .options(joinedload(LLMModel.provider))
            .where(
                LLMModel.id == draft_model_id,
                LLMModel.is_active,
            )
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
        stmt = select(LLMModel).where(LLMModel.is_active).options(joinedload(LLMModel.provider))
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
        await session.execute(delete(ProviderModel).where(ProviderModel.id == delete_id))


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
