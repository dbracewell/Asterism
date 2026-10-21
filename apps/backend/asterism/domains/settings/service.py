"""Service layer for settings: user settings, application settings, and provider/model management.

Conventions:

- Functions accept an optional ``session``; when omitted a new session is opened
  (for background use), when given the caller keeps ownership via
  :func:`get_async_db_session`.
- API keys round-trip redacted: responses serialize :class:`SecretStr` to
  ``**********``, and writes that echo that sentinel keep the stored key.
- Provider/model edits that could orphan the selected captioning model call
  :func:`asterism.domains.settings.captioning_guard.get_captioning_selection_guard`
  before commit. The knowledge domain owns that selection and registers the
  implementation; the settings domain never imports the knowledge package.
"""

import uuid
from typing import Any, cast

from pydantic import JsonValue, ValidationError
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, noload, selectinload

from asterism.common.log import get_logger
from asterism.core.events import EventType, NoArgEvent, event_bus
from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.models import AgentProfileModel

from .captioning_guard import get_captioning_selection_guard
from .models import (
    ApplicationSettingsModel,
    LLMModel,
    ProviderModel,
    UserSettingModel,
)
from .schemas import (
    ApplicationSettings,
    BulkUpdateSettingRequest,
    ComponentProviderParameters,
    Llm,
    LlmDisplayInfo,
    LlmWithProvider,
    Provider,
    ProviderInfo,
    ProviderModelsPage,
    ProviderModelUpdate,
    ProviderSettings,
    ProviderSummary,
    Setting,
    ToolSettings,
    UserSettings,
)
from .secrets import (
    REDACTED_SECRET,
    decrypt_component_provider_dict,
    encrypt_component_provider_dict,
)
from .tool_settings import COMPONENT_PROVIDER_KEYS, get_tool_settings

logger = get_logger("Settings")

_REDACTED_API_KEY = REDACTED_SECRET
_APP_SETTING_KEYS = frozenset(ApplicationSettings.model_fields.keys())


def _provider_api_key(provider: ProviderInfo, existing_api_key: str | None = None) -> str:
    """Unwrap a submitted API key without replacing an existing redacted key.

    Args:
        provider: The incoming provider payload; its ``api_key`` may be the
            redaction sentinel echoed back from a previous response.
        existing_api_key: The currently stored (decrypted) key, kept when the
            client did not submit a real replacement.

    Raises:
        BadDataException: When a brand-new provider echoes the redaction
            sentinel — there is no stored key to keep, so persisting the
            sentinel would store it as a literal credential.
    """
    api_key = provider.api_key.get_secret_value()
    if api_key == _REDACTED_API_KEY:
        if existing_api_key is None:
            raise BadDataException("A real API key is required for a new provider")
        return existing_api_key
    return api_key


# ------------------------------------------------------------------
# User settings
# ------------------------------------------------------------------


async def get_user_settings(
    user_id: str,
    session: AsyncSession | None = None,
) -> UserSettings:
    """Assemble one user's full settings aggregate.

    Merges the JSON key/value rows with the agent domain's main-agent and
    sub-agent records, then attaches the list of all active models.
    """
    import asterism.domains.agent.service as agent_service
    # cached = settings_cache.get_user_settings(user_id)
    # if cached:
    #     return cached

    async with get_async_db_session(session) as session:
        stmt = select(UserSettingModel).where(UserSettingModel.user_id == user_id)
        result = await session.scalars(stmt)
        combined: dict[str, Any] = {row.key: row.value for row in result.all()}

        combined["main_agent"] = await agent_service.get_main_agent(user_id, session)
        combined["sub_agents"] = {agent.id: agent for agent in await agent_service.get_sub_agents(user_id, session)}
        user_settings = UserSettings.model_validate(combined)
        user_settings.models = await get_user_models(session=session)

    # settings_cache.set_user_settings(user_id, user_settings)
    return user_settings


async def bulk_upsert_user_settings(
    user_id: str,
    updates: dict[str, Any],
    session: AsyncSession | None = None,
) -> UserSettings:
    """Validate then upsert several user settings atomically; returns the refreshed aggregate.

    A ``None`` value deletes that key instead of writing it.
    """
    async with get_async_db_session(session) as session:
        for key, value in updates.items():
            await _validate_user_setting(key, value, session)

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
                        },
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
    """Set one user setting (a ``None`` value deletes it); validates key and value shape."""

    if value is None:
        await delete_user_setting(user_id, key, session)
        return Setting(key=key, value=value)

    async with get_async_db_session(session) as session:
        await _validate_user_setting(key, value, session)
        stmt = (
            insert(UserSettingModel)
            .values(
                {
                    "user_id": user_id,
                    "value": value,
                    "key": key,
                },
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
    """Delete one user setting row; the key must be a known, deletable setting."""
    async with get_async_db_session(session) as session:
        await _validate_user_setting(key, None, session)
        stmt = delete(UserSettingModel).where(
            UserSettingModel.user_id == user_id,
            UserSettingModel.key == key,
        )
        await session.execute(stmt)
        await session.commit()
        # settings_cache.remove_user_setting(user_id)


async def _validate_user_setting(key: str, value: Any, session: AsyncSession) -> None:
    """Enforce the whitelist of user setting keys and per-key value shapes.

    ``default_model_id`` must reference an existing, active model; ``None``
    values (deletes) skip shape checks.
    """
    if key not in {"theme", "font_size", "default_model_id", "show_thinking"}:
        raise BadDataException("Unsupported user setting")
    if value is not None and key == "default_model_id":
        try:
            model_id = uuid.UUID(str(value))
        except ValueError as exc:
            raise BadDataException("default_model_id must be a model UUID") from exc
        model = await session.get(LLMModel, model_id)
        if model is None or not model.is_active:
            raise BadDataException("Default model must be available and active")
    if value is not None and key == "show_thinking" and not isinstance(value, bool):
        raise BadDataException("show_thinking must be boolean")
    if value is not None and key in {"theme", "font_size"} and not isinstance(value, str):
        raise BadDataException(f"{key} must be text")


async def _ensure_provider_unbound(provider_id: uuid.UUID, session: AsyncSession) -> None:
    """Refuse to delete a provider still referenced by any sub-agent definition."""
    bound = await session.scalar(
        select(AgentProfileModel.id)
        .join(
            LLMModel,
            LLMModel.id == AgentProfileModel.model_id,
        )
        .where(LLMModel.provider_id == provider_id, AgentProfileModel.sub_agent.is_(True))
        .limit(1),
    )
    if bound is not None:
        raise BadDataException("Rebind or delete sub-agents before deleting their model provider")


async def _delete_missing_providers(
    existing_ids: set[uuid.UUID],
    incoming_ids: set[uuid.UUID],
    session: AsyncSession,
) -> None:
    """Delete providers absent from the incoming list (after the binding check)."""
    for deleted_id in existing_ids.difference(incoming_ids):
        await _ensure_provider_unbound(deleted_id, session)
        await session.execute(delete(ProviderModel).where(ProviderModel.id == deleted_id))


# ------------------------------------------------------------------
# Application settings
# ------------------------------------------------------------------


async def get_provider_settings(
    session: AsyncSession | None = None,
) -> ProviderSettings:
    """Build the provider landing-page payload (summaries plus the draft model)."""
    async with get_async_db_session(session) as session:
        model_count = select(func.count(LLMModel.id)).where(LLMModel.provider_id == ProviderModel.id).scalar_subquery()
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
            ),
        )

        draft_model = None
        parsed_draft_model_id: uuid.UUID | None = None
        if draft_model_id:
            try:
                parsed_draft_model_id = uuid.UUID(str(draft_model_id))
            except (TypeError, ValueError):
                # A hand-edited setting can hold a non-UUID string; treat it as
                # unset rather than failing the whole landing-page payload.
                logger.warning("Stored draft_model_id setting is not a valid UUID; ignoring it")
            draft_row = (
                await session.scalar(
                    select(LLMModel).where(LLMModel.id == parsed_draft_model_id).options(joinedload(LLMModel.provider)),
                )
                if parsed_draft_model_id is not None
                else None
            )
            if draft_row is not None:
                draft_model = LlmDisplayInfo(
                    id=draft_row.id,
                    name=draft_row.name,
                    provider_id=draft_row.provider_id,
                    provider_name=draft_row.provider.name,
                    context_window=draft_row.context_window,
                    supports_vision=draft_row.supports_vision,
                    supports_tools=draft_row.supports_tools,
                    tools_source=draft_row.tools_source,
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
            draft_model_id=parsed_draft_model_id,
            draft_model=draft_model,
        )


async def update_provider_settings(
    settings: ProviderSettings,
    session: AsyncSession | None = None,
) -> ProviderSettings:
    """Replace the full provider list.

    Providers absent from the payload are deleted (after a sub-agent binding
    check); present providers have their connection fields updated but their
    model lists are left untouched. The draft selection is cleared if its
    provider was removed and validated otherwise. Emits DRAFT_MODEL_UPDATED.
    """
    async with get_async_db_session(session) as session:
        existing_providers = {
            provider.id: provider
            for provider in (await session.scalars(select(ProviderModel).options(noload(ProviderModel.models)))).all()
        }
        incoming_ids = {provider.id for provider in settings.llm_providers}
        draft_model_id = settings.draft_model_id
        if draft_model_id is not None:
            draft_provider_id = await session.scalar(select(LLMModel.provider_id).where(LLMModel.id == draft_model_id))
            if draft_provider_id is not None and draft_provider_id not in incoming_ids:
                draft_model_id = None
        await _delete_missing_providers(set(existing_providers), incoming_ids, session)

        for provider in settings.llm_providers:
            existing = existing_providers.get(provider.id)
            if existing is None:
                session.add(
                    ProviderModel(
                        id=provider.id,
                        provider_type=provider.provider_type,
                        name=provider.name,
                        base_url=provider.base_url,
                        api_key=_provider_api_key(provider),
                    ),
                )
            else:
                existing.provider_type = provider.provider_type
                existing.name = provider.name
                existing.base_url = provider.base_url
                existing.api_key = _provider_api_key(provider, existing.api_key)

        # A provider-settings replacement may remove a provider (and its
        # cascade-owned models).  The selected captioner is part of the global
        # processing policy, so reject that edit rather than leaving a stored
        # policy pointing at a missing or ineligible model.
        await get_captioning_selection_guard().validate(session=session)

        if draft_model_id is not None:
            draft_model = await session.scalar(
                select(LLMModel).where(
                    LLMModel.id == draft_model_id,
                    LLMModel.is_active,
                ),
            )
            if draft_model is None:
                raise BadDataException("draft_model_id must reference an active model")
        # Clearing the draft deletes its row; the value column is NOT NULL and
        # an absent row means "no draft selected".
        if draft_model_id is None:
            await session.execute(
                delete(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "draft_model_id")
            )
        else:
            stmt = (
                insert(ApplicationSettingsModel)
                .values({"key": "draft_model_id", "value": str(draft_model_id)})
                .on_conflict_do_update(
                    index_elements=["key"],
                    set_={"value": str(draft_model_id)},
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
    """Keyset-paginated, case-insensitive search over one provider's models.

    Pages by ``(lower(name), id)``; ``cursor`` must be a model id from this
    provider and is validated before the page query runs.
    """
    async with get_async_db_session(session) as session:
        exists = await session.scalar(select(ProviderModel.id).where(ProviderModel.id == provider_id))
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
                ),
            )
            if cursor_model is None:
                raise BadDataException("cursor must reference a model in this provider")
            cursor_name = cursor_model.name.lower()
            filters.append(
                or_(
                    normalized_name > cursor_name,
                    and_(normalized_name == cursor_name, LLMModel.id > cursor),
                ),
            )

        rows = list(
            (
                await session.scalars(
                    select(LLMModel).where(*filters).order_by(normalized_name, LLMModel.id).limit(limit + 1),
                )
            ).all(),
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
    """Replace one model's flags/capabilities; keeps the draft selection valid.

    If the edit deactivates the current draft model, the draft moves to the
    first active model (by name) or is cleared. Emits DRAFT_MODEL_UPDATED.
    """
    async with get_async_db_session(session) as session:
        model = await session.scalar(
            select(LLMModel).where(
                LLMModel.id == model_id,
                LLMModel.provider_id == provider_id,
            ),
        )
        if model is None:
            raise NotFoundException(f"Model id {model_id} not found in provider")

        model.is_active = update.is_active
        model.context_window = update.context_window
        model.tools_source = update.tools_source
        model.supports_tools = update.supports_tools
        model.supports_vision = update.supports_vision
        model.context_window_source = update.context_window_source
        model.vision_source = update.vision_source
        await session.flush()

        await get_captioning_selection_guard().validate(session=session)

        draft_model_id = await session.scalar(
            select(ApplicationSettingsModel.value).where(
                ApplicationSettingsModel.key == "draft_model_id",
            ),
        )
        if not model.is_active and str(model.id) == str(draft_model_id):
            replacement = await session.scalar(
                select(LLMModel.id).where(LLMModel.is_active).order_by(func.lower(LLMModel.name), LLMModel.id).limit(1),
            )
            if replacement is None:
                # No active model remains; clear the draft by deleting its row.
                await session.execute(
                    delete(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "draft_model_id")
                )
            else:
                await session.execute(
                    insert(ApplicationSettingsModel)
                    .values({"key": "draft_model_id", "value": str(replacement)})
                    .on_conflict_do_update(
                        index_elements=["key"],
                        set_={"value": str(replacement)},
                    ),
                )
        await session.commit()
        result = Llm.model_validate(model)

    event_bus.emit(NoArgEvent(type=EventType.DRAFT_MODEL_UPDATED))
    return result


async def get_provider_for_discovery(
    provider_id: uuid.UUID,
    session: AsyncSession | None = None,
) -> Provider:
    """Load a provider with its models for a discovery run."""
    async with get_async_db_session(session) as session:
        provider = await session.scalar(
            select(ProviderModel).where(ProviderModel.id == provider_id).options(selectinload(ProviderModel.models)),
        )
        if provider is None:
            raise NotFoundException(f"Provider id {provider_id} not found in database")
        return Provider.model_validate(provider)


async def replace_provider_models(
    provider_id: uuid.UUID,
    models: list[Llm],
    session: AsyncSession | None = None,
) -> ProviderSummary:
    """Merge discovered models into a provider, deleting models no longer listed.

    Raises ConflictException if an agent or project still references a removed model.
    """
    async with get_async_db_session(session) as session:
        provider = await session.scalar(
            select(ProviderModel).where(ProviderModel.id == provider_id).options(selectinload(ProviderModel.models)),
        )
        if provider is None:
            raise NotFoundException(f"Provider id {provider_id} not found in database")
        provider.models = _merge_models(models, provider.models)

        await get_captioning_selection_guard().validate(session=session)
        try:
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise ConflictException("Cannot remove model currently in use by an agent or project") from exc

    settings = await get_provider_settings(session)
    summary = next((item for item in settings.llm_providers if item.id == provider_id), None)
    if summary is None:
        raise NotFoundException(f"Provider id {provider_id} not found in database")
    return summary


async def get_captioning_models(
    session: AsyncSession | None = None,
) -> list[LlmDisplayInfo]:
    """List active vision-capable models eligible for image captioning."""
    async with get_async_db_session(session) as session:
        rows = list(
            (
                await session.scalars(
                    # ``supports_vision=True`` already implies a non-UNKNOWN
                    # vision_source (schema normalization), so no source filter.
                    select(LLMModel).where(
                        LLMModel.is_active.is_(True),
                        LLMModel.supports_vision.is_(True),
                    )
                    .options(joinedload(LLMModel.provider))
                    .order_by(func.lower(LLMModel.name), LLMModel.id),
                )
            ).all(),
        )
        return [
            LlmDisplayInfo(
                id=model.id,
                name=model.name,
                provider_id=model.provider_id,
                provider_name=model.provider.name,
                context_window=model.context_window,
                supports_vision=model.supports_vision,
                supports_tools=model.supports_tools,
                tools_source=model.tools_source,
                context_window_source=model.context_window_source,
                vision_source=model.vision_source,
            )
            for model in rows
        ]


async def update_tool_settings(
    settings: ToolSettings,
    session: AsyncSession | None = None,
) -> ToolSettings:
    """Replace tool settings, encrypting component provider parameters at rest."""
    async with get_async_db_session(session) as session:
        existing_rows = {
            row.key: row.value
            for row in (
                await session.scalars(
                    select(ApplicationSettingsModel).where(
                        ApplicationSettingsModel.key.in_(COMPONENT_PROVIDER_KEYS),
                    ),
                )
            ).all()
        }
        values = {
            "active_tools": settings.active_tools,
            "web_search_provider": encrypt_component_provider_dict(
                settings.web_search_provider.model_dump() if settings.web_search_provider else None,
                cast(dict[str, Any] | None, existing_rows.get("web_search_provider")),
            ),
            "image_search_provider": encrypt_component_provider_dict(
                settings.image_search_provider.model_dump() if settings.image_search_provider else None,
                cast(dict[str, Any] | None, existing_rows.get("image_search_provider")),
            ),
        }
        for key, value in values.items():
            if value is None:
                # Clearing a component provider deletes its row; the value column
                # is NOT NULL and an absent row means "unset".
                await session.execute(delete(ApplicationSettingsModel).where(ApplicationSettingsModel.key == key))
            else:
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
    """Assemble the full application settings aggregate (admin view)."""
    async with get_async_db_session(session) as session:
        stmt = select(ApplicationSettingsModel)
        result = await session.scalars(stmt)
        full: dict[str, Any] = {
            row.key: (decrypt_component_provider_dict(row.value) if row.key in COMPONENT_PROVIDER_KEYS else row.value)
            for row in result.all()
        }

        if "active_tools" not in full:
            full["active_tools"] = []

        # Legacy "" values written by older clients for an unselected draft
        # model are already normalized to None by the JSON column type.
        new_setting = ApplicationSettings.model_validate(full)
        providers = await get_all_providers(session)
        new_setting.llm_providers = [Provider.model_validate(p) for p in providers]

        return new_setting


def _validate_app_setting_key(key: str) -> None:
    """Reject setting keys outside the :class:`ApplicationSettings` schema."""
    if key not in _APP_SETTING_KEYS:
        raise BadDataException(f"Unsupported application setting key: {key}")


def _parse_llm_providers_setting(value: JsonValue) -> list[Provider]:
    """Validate a raw JSON value as a list of provider configurations."""
    if not isinstance(value, list):
        raise BadDataException("Invalid value for application setting 'llm_providers'")
    try:
        return [Provider.model_validate(item) for item in value]
    except ValidationError as exc:
        raise BadDataException("Invalid value for application setting 'llm_providers'") from exc


def _validate_non_provider_app_setting(
    key: str,
    value: JsonValue,
) -> tuple[JsonValue, ComponentProviderParameters | None]:
    """Normalize and validate one non-provider application setting value.

    Returns ``(normalized_value, validated_component)``; the component is only
    set for component-provider keys so callers can encrypt it for storage.
    """
    if key == "draft_model_id":
        if value == "" or value is None:
            return None, None
        if not isinstance(value, str):
            raise BadDataException("Invalid value for application setting 'draft_model_id'")
        try:
            return str(uuid.UUID(value)), None
        except ValueError as exc:
            raise BadDataException("Invalid value for application setting 'draft_model_id'") from exc

    if key in COMPONENT_PROVIDER_KEYS:
        if value is None:
            return None, None
        if not isinstance(value, dict):
            raise BadDataException(f"Invalid value for application setting '{key}'")
        try:
            validated = ComponentProviderParameters.model_validate(value)
        except ValidationError as exc:
            raise BadDataException(f"Invalid value for application setting '{key}'") from exc
        return value, validated

    if key == "active_tools":
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise BadDataException("Invalid value for application setting 'active_tools'")
        return cast(JsonValue, list(value)), None

    raise BadDataException(f"Unsupported application setting key: {key}")


async def upsert_app_setting(
    key: str,
    value: JsonValue,
    session: AsyncSession | None = None,
) -> Setting:
    """Set one application setting by key (a ``None`` value deletes it).

    ``llm_providers`` is a special case that rewrites the provider tables;
    component providers are encrypted before storage and returned redacted.
    Emits DRAFT_MODEL_UPDATED when the draft selection changes.
    """
    _validate_app_setting_key(key)
    if key == "draft_model_id" and value == "":
        value = None
    if value is None:
        await delete_app_setting(key, session)
        return Setting(key=key, value=value)

    async with get_async_db_session(session) as session:
        draft_model_updated = False

        if key == "llm_providers":
            llm_providers = _parse_llm_providers_setting(value)
            await bulk_upsert_providers(
                llm_providers,
                session=session,
            )
            await session.commit()
            redacted = [
                Provider.model_validate(p).model_dump(mode="json") for p in await get_all_providers(session=session)
            ]
            return Setting(key=key, value=redacted)

        normalized_value, validated_component = _validate_non_provider_app_setting(key, value)
        if key == "draft_model_id":
            draft_model_updated = True

        stored_value: JsonValue = normalized_value
        response_value: JsonValue = normalized_value
        if validated_component is not None:
            existing_val = await session.scalar(
                select(ApplicationSettingsModel.value).where(ApplicationSettingsModel.key == key),
            )
            stored_value = encrypt_component_provider_dict(
                validated_component.model_dump(),
                cast(dict[str, Any] | None, existing_val),
            )
            response_value = ComponentProviderParameters.model_validate(
                decrypt_component_provider_dict(stored_value),
            ).model_dump(mode="json")

        stmt = (
            insert(ApplicationSettingsModel)
            .values(
                {
                    "value": stored_value,
                    "key": key,
                },
            )
            .on_conflict_do_update(
                index_elements=["key"],
                set_={
                    "value": stored_value,
                },
            )
        )
        await session.execute(stmt)
        await session.commit()

        if draft_model_updated:
            event_bus.emit(NoArgEvent(type=EventType.DRAFT_MODEL_UPDATED))

        return Setting(key=key, value=response_value)


async def delete_app_setting(
    key: str,
    session: AsyncSession | None = None,
) -> None:
    """Delete one application setting; required keys cannot be deleted."""
    _validate_app_setting_key(key)
    if key in ("llm_providers", "active_tools"):
        raise BadDataException(f"Cannot delete required application setting '{key}'")
    async with get_async_db_session(session) as session:
        stmt = delete(ApplicationSettingsModel).where(ApplicationSettingsModel.key == key)
        await session.execute(stmt)
        await session.commit()


async def bulk_update_app_setting(
    updates: BulkUpdateSettingRequest,
    session: AsyncSession | None = None,
) -> ApplicationSettings:
    """Apply several application setting updates in one transaction."""
    for key in updates.values:
        _validate_app_setting_key(key)

    async with get_async_db_session(session) as session:
        draft_model_updated = False

        for key, value in updates.values.items():
            # Special case that the llm providers are being updated
            if key == "llm_providers":
                llm_providers = _parse_llm_providers_setting(value)
                await bulk_upsert_providers(
                    llm_providers,
                    session=session,
                )
                continue

            normalized_value, validated_component = _validate_non_provider_app_setting(key, value)
            if key == "draft_model_id":
                draft_model_updated = True

            stored_value: JsonValue = normalized_value
            if validated_component is not None:
                existing_val = await session.scalar(
                    select(ApplicationSettingsModel.value).where(ApplicationSettingsModel.key == key),
                )
                stored_value = encrypt_component_provider_dict(
                    validated_component.model_dump(),
                    cast(dict[str, Any] | None, existing_val),
                )

            # A normalized ``None`` clears the setting: delete its row, since
            # the value column is NOT NULL and an absent row means "unset".
            if stored_value is None:
                await session.execute(delete(ApplicationSettingsModel).where(ApplicationSettingsModel.key == key))
                continue

            stmt = (
                insert(ApplicationSettingsModel)
                .values(
                    {
                        "value": stored_value,
                        "key": key,
                    },
                )
                .on_conflict_do_update(
                    index_elements=["key"],
                    set_={
                        "value": stored_value,
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
    """Resolve the configured draft model with its provider; 404 if unset or inactive."""
    async with get_async_db_session(session) as session:
        stmt = select(ApplicationSettingsModel.value).where(ApplicationSettingsModel.key == "draft_model_id")

        value = await session.scalar(stmt)
        if not value:
            raise NotFoundException("Draft model not set in application settings")

        try:
            draft_model_id = uuid.UUID(str(value))
        except (TypeError, ValueError) as exc:
            # A hand-edited setting can hold a non-UUID string.
            raise BadDataException("Stored draft_model_id setting is not a valid UUID") from exc

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
    """Load all providers eagerly including their models."""
    async with get_async_db_session(session) as session:
        stmt = select(ProviderModel).options(
            selectinload(ProviderModel.models),
        )
        result = await session.scalars(stmt)
        return list(result.all())


async def get_user_models(
    session: AsyncSession | None = None,
) -> list[LlmDisplayInfo]:
    """List every active model across providers (models are global, not per-user)."""
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
                    supports_tools=m.supports_tools,
                    tools_source=m.tools_source,
                    context_window_source=m.context_window_source,
                    vision_source=m.vision_source,
                ),
            )
        return models


async def get_model_and_provider(
    model_id: uuid.UUID,
    session: AsyncSession | None = None,
) -> LlmWithProvider:
    """Fetch an active model with its provider for execution."""
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
    session: AsyncSession | None = None,
) -> Llm:
    """Fetch an active model without its provider."""
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
    """Sync the provider tables with a full provider list (the caller owns the transaction).

    Updates/creates providers, merges each provider's models by name, and
    deletes providers absent from the payload after the sub-agent binding check.
    """
    current_providers = await get_all_providers(session=session)
    processed_providers = set()
    existing_providers = {p.id: p for p in current_providers}

    for provider in update:
        existing_provider = existing_providers.get(provider.id, None)

        if existing_provider:
            processed_providers.add(provider.id)
            existing_provider.provider_type = provider.provider_type
            existing_provider.base_url = provider.base_url
            existing_provider.api_key = _provider_api_key(
                provider,
                existing_provider.api_key,
            )
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
                api_key=_provider_api_key(provider),
                models=[
                    LLMModel(
                        id=m.id,
                        name=m.name,
                        is_active=m.is_active,
                        context_window=m.context_window,
                        supports_vision=m.supports_vision,
                        supports_tools=m.supports_tools,
                        tools_source=m.tools_source,
                        context_window_source=m.context_window_source,
                        vision_source=m.vision_source,
                    )
                    for m in provider.models
                ],
            )
            session.add(new_provider)
            await session.flush()

    await _delete_missing_providers(set(existing_providers), processed_providers, session)

    await get_captioning_selection_guard().validate(session=session)


def _merge_models(
    new_models: list[Llm],
    existing: list[LLMModel],
):
    """Merge incoming model data into existing ORM rows keyed by name.

    Existing rows keep their identity (id); models absent from ``new_models``
    are dropped from the returned list so the delete-orphan cascade removes them.
    """
    existing_models_by_name = {m.name: m for m in existing}
    synced_models: list[LLMModel] = []
    for m_data in new_models:
        if m_data.name in existing_models_by_name:
            existing_model = existing_models_by_name[m_data.name]
            existing_model.is_active = m_data.is_active
            existing_model.context_window = m_data.context_window
            existing_model.tools_source = m_data.tools_source
            existing_model.supports_tools = m_data.supports_tools
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
                supports_tools=m_data.supports_tools,
                tools_source=m_data.tools_source,
                context_window_source=m_data.context_window_source,
                vision_source=m_data.vision_source,
            )
            synced_models.append(new_model)
    return synced_models
