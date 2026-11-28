"""Application settings: validated reads and writes of ``app_settings`` rows, and tool settings.

``llm_providers`` writes go through :mod:`.providers`; component providers are
encrypted before storage and returned redacted.
"""

import uuid
from typing import Any, cast

from pydantic import JsonValue, ValidationError
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.events import EventType, NoArgEvent, event_bus
from asterism.core.exceptions import BadDataException
from asterism.db.database import get_async_db_session

from .models import (
    ApplicationSettingsModel,
)
from .providers import bulk_upsert_providers, get_all_providers
from .schemas import (
    ApplicationSettings,
    BulkUpdateSettingRequest,
    CompactionSettings,
    ComponentProviderParameters,
    Provider,
    Setting,
    ToolSettings,
)
from .secrets import (
    decrypt_component_provider_dict,
    encrypt_component_provider_dict,
)
from .tool_settings import COMPONENT_PROVIDER_KEYS, get_tool_settings

_APP_SETTING_KEYS = frozenset(ApplicationSettings.model_fields.keys())


async def update_tool_settings(
    settings: ToolSettings,
    session: AsyncSession | None = None,
) -> ToolSettings:
    """Replace tool settings, encrypting component provider parameters at rest.

    Component parameters are checked against the selected component's own
    model, as the single-setting route checks them (US-117.1).
    """
    web_search = settings.web_search_provider and _check_component_parameters(
        "web_search_provider", settings.web_search_provider
    )
    image_search = settings.image_search_provider and _check_component_parameters(
        "image_search_provider", settings.image_search_provider
    )
    async with get_async_db_session(session) as session:
        existing_rows = {
            row.key: row.value
            for row in (
                await session.scalars(
                    select(ApplicationSettingsModel).where(
                        ApplicationSettingsModel.key.in_(list(COMPONENT_PROVIDER_KEYS)),
                    ),
                )
            ).all()
        }
        values = {
            "active_tools": settings.active_tools,
            "web_search_provider": encrypt_component_provider_dict(
                web_search.model_dump() if web_search else None,
                cast(dict[str, Any] | None, existing_rows.get("web_search_provider")),
            ),
            "image_search_provider": encrypt_component_provider_dict(
                image_search.model_dump() if image_search else None,
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


def validation_message(error: ValidationError) -> str:
    """The first problem in a validation error, phrased for an admin."""
    first = error.errors()[0]
    where = ".".join(str(part) for part in first.get("loc", ()) if part != "__root__")
    message = str(first.get("msg", "is invalid")).removeprefix("Value error, ")
    return f"{where}: {message}" if where else message


def _check_component_parameters(key: str, value: ComponentProviderParameters) -> ComponentProviderParameters:
    """Check parameters against the selected component's own model and store them normalized.

    Secrets may be the redaction marker (keep the stored value); it validates as a string.
    """
    from asterism.domains.components.catalog import ensure_loaded
    from asterism.domains.components.registry import component_registry
    from asterism.domains.components.schemas import ComponentType

    ensure_loaded()
    component = component_registry.find(ComponentType(COMPONENT_PROVIDER_KEYS[key]), value.name)
    if component is None:
        raise BadDataException(f"Unknown provider '{value.name}' for application setting '{key}'")
    try:
        parameters = component.parameters.model_validate(value.parameters)
    except ValidationError as exc:
        raise BadDataException(f"Invalid {value.name} settings: {validation_message(exc)}") from exc
    return ComponentProviderParameters(name=component.name, parameters=parameters.model_dump(mode="json"))


_GROUP_LIMITED_POLICIES = frozenset({"memory", "image_generation", "study_chat"})


async def _check_policy_groups(key: str, value: JsonValue, session: AsyncSession) -> None:
    """A policy limited to groups names only groups that exist, whichever route sets it (US-117.1)."""
    if key not in _GROUP_LIMITED_POLICIES or not isinstance(value, dict):
        return
    group_ids = value.get("group_ids")
    if not isinstance(group_ids, list):
        return
    from asterism.domains.groups.service import list_groups

    known = {group.id for group in await list_groups(session)}
    if unknown := {str(group_id) for group_id in group_ids} - known:
        raise BadDataException(f"Unknown groups: {', '.join(sorted(unknown))}")


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
        validated = _check_component_parameters(key, validated)
        return value, validated

    if key == "skills_enabled":
        if type(value) is not bool:
            raise BadDataException("Skills policy must be a boolean")
        return value, None

    if key == "canvas_enabled":
        if type(value) is not bool:
            raise BadDataException("Canvas policy must be a boolean")
        return value, None

    if key == "image_generation":
        from asterism.domains.image_generation.schemas import ImageGenerationPolicy

        try:
            return ImageGenerationPolicy.model_validate(value).model_dump(mode="json"), None
        except ValidationError as exc:
            raise BadDataException("Invalid image generation policy") from exc

    if key == "memory":
        from asterism.domains.memory.schemas import MemoryPolicy

        try:
            return MemoryPolicy.model_validate(value).model_dump(mode="json"), None
        except ValidationError as exc:
            raise BadDataException("Invalid memory policy") from exc

    if key == "study_chat":
        from asterism.domains.study.chat_policy_schemas import StudyChatPolicy

        try:
            return StudyChatPolicy.model_validate(value).model_dump(mode="json"), None
        except ValidationError as exc:
            raise BadDataException("Invalid study chat policy") from exc

    if key == "image_generation_local":
        from asterism.domains.image_generation.local.schemas import LocalSettings

        try:
            return LocalSettings.model_validate(value).model_dump(mode="json"), None
        except ValidationError as exc:
            raise BadDataException("Invalid local image generation settings") from exc

    if key == "image_generation_onnx":
        from asterism.domains.image_generation.onnx.schemas import OnnxSettings

        try:
            return OnnxSettings.model_validate(value).model_dump(mode="json"), None
        except ValidationError as exc:
            raise BadDataException("Invalid ONNX image generation settings") from exc

    if key == "compaction":
        try:
            return CompactionSettings.model_validate(value).model_dump(mode="json"), None
        except ValidationError as exc:
            raise BadDataException("Invalid compaction settings") from exc

    if key == "setup_progress":
        from asterism.domains.setup.schemas import SetupProgress

        try:
            return SetupProgress.model_validate(value).model_dump(mode="json"), None
        except ValidationError as exc:
            raise BadDataException("Invalid setup progress") from exc

    if key == "chatgpt_plan_enabled":
        if type(value) is not bool:
            raise BadDataException("ChatGPT plan policy must be a boolean")
        return value, None

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
        await _check_policy_groups(key, normalized_value, session)
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
