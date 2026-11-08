"""Merge an encrypted settings file into this instance (US-63.2).

Merging never removes anything. Providers in the file are added or updated by
name, and models by name within them. Groups are matched by built-in key or by
name; their access lists are replaced, and membership is never touched. Values the file holds overwrite current
ones; a value it lacks, such as no draft model, leaves the current one alone.
Providers it does not mention stay, so sub-agents bound to their models keep
working.

Everything is staged on one session. Captioning goes last because its transition
commits that session, which carries the whole import in one transaction; any
earlier failure rolls everything back.
"""

import asyncio
import uuid

from pydantic_core import PydanticCustomError
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.events import EventType, NoArgEvent, event_bus
from asterism.core.exceptions import BadDataException, ConflictException
from asterism.domains.groups.models import GroupModel
from asterism.domains.knowledge.processing import update_captioning_configuration
from asterism.domains.knowledge.processing_schemas import KnowledgeCaptionConfigurationUpdate
from asterism.domains.settings.captioning_guard import get_captioning_selection_guard
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel, ProviderModel
from asterism.domains.settings.provider_types import ProviderType, normalize_provider_base_url
from asterism.domains.settings.queries import is_global_provider
from asterism.domains.settings.secrets import REDACTED_SECRET, encrypt_component_provider_dict
from asterism.domains.settings.service import get_all_providers
from asterism.domains.tools.catalog import INTERNAL_TOOL_NAMES

from .documents import (
    ExportedComponent,
    ExportedModel,
    ExportedProvider,
    ModelReference,
    SettingsBundle,
    read_envelope,
    unseal,
)
from .export import collect_settings
from .schemas import ProviderChange, SettingsImportSummary

logger = get_logger("SettingsImport")


def _check_references(bundle: SettingsBundle) -> None:
    known = {(provider.name, model.name) for provider in bundle.providers for model in provider.models}
    group_models = (reference for group in bundle.groups for reference in group.models or ())
    for reference in (bundle.draft_model, bundle.captioning.model, *group_models):
        if reference is not None and (reference.provider, reference.model) not in known:
            raise BadDataException("Settings file refers to a model it does not contain")


def _check_groups(bundle: SettingsBundle) -> None:
    names = [group.name.strip().casefold() for group in bundle.groups]
    keys = [group.built_in for group in bundle.groups if group.built_in]
    if len(set(names)) != len(names) or len(set(keys)) != len(keys) or not all(names):
        raise BadDataException("Settings file has blank or duplicate group names")
    if any(set(group.tools or ()) & INTERNAL_TOOL_NAMES for group in bundle.groups):
        raise BadDataException("Settings file lists internal tools in a group")


def _check_bundle(bundle: SettingsBundle) -> None:
    """A valid passphrase proves who wrote a file, not that its contents are sound."""
    names = [provider.name for provider in bundle.providers]
    if len(set(names)) != len(names) or not all(name.strip() for name in names):
        raise BadDataException("Settings file has blank or duplicate provider names")
    for provider in bundle.providers:
        if provider.provider_type == ProviderType.CHATGPT:
            raise BadDataException("Settings file has a provider type that cannot be imported")
        if provider.api_key == REDACTED_SECRET:
            raise BadDataException("Settings file has a redacted provider key")
        models = [model.name for model in provider.models]
        if len(set(models)) != len(models) or not all(name.strip() for name in models):
            raise BadDataException("Settings file has blank or duplicate model names")
        try:
            normalize_provider_base_url(provider.provider_type, provider.base_url)
        except PydanticCustomError as exc:
            raise BadDataException("Settings file has an invalid provider URL") from exc
    _check_references(bundle)
    _check_groups(bundle)


async def _open(source: str, passphrase: str) -> SettingsBundle:
    envelope = read_envelope(source)
    bundle = await asyncio.to_thread(unseal, envelope, passphrase)
    _check_bundle(bundle)
    return bundle


def _provider_change(incoming: ExportedProvider, existing: ProviderModel | None) -> ProviderChange:
    known = {model.name for model in existing.models} if existing else set()
    added = sum(model.name not in known for model in incoming.models)
    return ProviderChange(
        name=incoming.name,
        action="update" if existing else "add",
        models_added=added,
        models_updated=len(incoming.models) - added,
    )


def _changed_settings(bundle: SettingsBundle, current: SettingsBundle) -> list[str]:
    changes = {
        "Draft model": bundle.draft_model is not None and bundle.draft_model != current.draft_model,
        "Active tools": set(bundle.active_tools) != set(current.active_tools),
        "Skills policy": bundle.skills_enabled != current.skills_enabled,
        "ChatGPT plan policy": bundle.chatgpt_plan_enabled != current.chatgpt_plan_enabled,
        "Web search provider": bundle.web_search_provider is not None
        and bundle.web_search_provider != current.web_search_provider,
        "Image search provider": bundle.image_search_provider is not None
        and bundle.image_search_provider != current.image_search_provider,
        "Image captioning": bundle.captioning != current.captioning,
        "Groups": bundle.groups != current.groups,
    }
    return [label for label, changed in changes.items() if changed]


async def _summary(bundle: SettingsBundle, session: AsyncSession) -> SettingsImportSummary:
    providers = {row.name: row for row in await get_all_providers(session)}
    incoming = {provider.name for provider in bundle.providers}
    return SettingsImportSummary(
        exported_at=bundle.exported_at,
        providers=[_provider_change(provider, providers.get(provider.name)) for provider in bundle.providers],
        kept_providers=sorted(set(providers) - incoming),
        changed_settings=_changed_settings(bundle, await collect_settings(session)),
    )


async def preview_settings(*, source: str, passphrase: str, session: AsyncSession) -> SettingsImportSummary:
    """Say what an import would change, without any keys. Nothing is written."""
    return await _summary(await _open(source, passphrase), session)


def _model_values(model: ExportedModel) -> dict:
    return {
        "display_name": model.display_name,
        "is_active": model.is_active,
        "context_window": model.context_window,
        "supports_vision": model.supports_vision,
        "supports_tools": model.supports_tools,
        "tools_source": model.tools_source,
        "context_window_source": model.context_window_source,
        "vision_source": model.vision_source,
        "pricing": model.pricing,
    }


def _merge_provider(incoming: ExportedProvider, existing: ProviderModel | None, session: AsyncSession) -> None:
    base_url = normalize_provider_base_url(incoming.provider_type, incoming.base_url)
    if existing is None:
        existing = ProviderModel(name=incoming.name, provider_type=incoming.provider_type, base_url=base_url)
        existing.api_key = incoming.api_key
        session.add(existing)
    else:
        existing.provider_type = incoming.provider_type
        existing.base_url = base_url
        existing.api_key = incoming.api_key
    models = {model.name: model for model in existing.models}
    for model in incoming.models:
        row = models.get(model.name)
        if row is None:
            existing.models.append(LLMModel(name=model.name, **_model_values(model)))
        else:
            for field, value in _model_values(model).items():
                setattr(row, field, value)


async def _put_setting(key: str, value, session: AsyncSession) -> None:
    await session.execute(
        insert(ApplicationSettingsModel)
        .values(key=key, value=value)
        .on_conflict_do_update(index_elements=[ApplicationSettingsModel.key], set_={"value": value})
    )


async def _put_component(key: str, component: ExportedComponent | None, session: AsyncSession) -> None:
    if component is not None:
        await _put_setting(key, encrypt_component_provider_dict(component.model_dump()), session)


async def _find_model(reference: ModelReference | None, session: AsyncSession) -> LLMModel | None:
    if reference is None:
        return None
    return await session.scalar(
        select(LLMModel)
        .join(LLMModel.provider)
        .where(is_global_provider(), ProviderModel.name == reference.provider, LLMModel.name == reference.model)
        .order_by(LLMModel.id)
    )


async def _apply_draft(reference: ModelReference | None, session: AsyncSession) -> None:
    model = await _find_model(reference, session)
    if model is not None and model.is_active:
        await _put_setting("draft_model_id", str(model.id), session)
        return
    row = await session.get(ApplicationSettingsModel, "draft_model_id")
    if row is None:
        return
    current = await session.scalar(select(LLMModel.is_active).where(LLMModel.id == uuid.UUID(str(row.value))))
    if current is not True:
        # The merge deactivated the selected model. An absent row means no draft model.
        await session.execute(delete(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "draft_model_id"))


async def _apply_groups(bundle: SettingsBundle, session: AsyncSession) -> None:
    """Add missing custom groups and set every listed group's access. Groups not in the file stay."""
    rows = list(await session.scalars(select(GroupModel)))
    built_in = {row.id: row for row in rows if row.built_in}
    by_name = {row.name.casefold(): row for row in rows}
    for group in bundle.groups:
        name = group.name.strip()
        row = built_in.get(group.built_in) if group.built_in else by_name.get(name.casefold())
        if row is None:
            row = GroupModel(name=name)
            session.add(row)
        elif row.built_in and not group.built_in:
            raise BadDataException(f"Settings file has a custom group named like the built-in group {row.name}")
        if group.models is None:
            row.model_access = None
        else:
            found = [await _find_model(reference, session) for reference in group.models]
            row.model_access = sorted({str(model.id) for model in found if model is not None})
        row.tool_access = None if group.tools is None else sorted(set(group.tools))


async def _apply_captioning(bundle: SettingsBundle, session: AsyncSession) -> None:
    captioning = bundle.captioning
    model = await _find_model(captioning.model, session)
    if captioning.mode == "provider" and model is None:
        # The exported model was deleted, so the file has no selection to apply.
        await get_captioning_selection_guard().validate(session=session)
        return
    await update_captioning_configuration(
        payload=KnowledgeCaptionConfigurationUpdate(
            mode=captioning.mode, provider_model_id=model.id if model is not None else None
        ),
        session=session,
    )


async def import_settings(
    *, admin_id: str, source: str, passphrase: str, session: AsyncSession
) -> SettingsImportSummary:
    """Merge a settings file, or change nothing if any part of it fails."""
    bundle = await _open(source, passphrase)
    summary = await _summary(bundle, session)
    try:
        providers = {row.name: row for row in await get_all_providers(session)}
        for provider in bundle.providers:
            _merge_provider(provider, providers.get(provider.name), session)
        await session.flush()
        await _put_setting("active_tools", list(bundle.active_tools), session)
        await _put_setting("skills_enabled", bundle.skills_enabled, session)
        await _put_setting("chatgpt_plan_enabled", bundle.chatgpt_plan_enabled, session)
        await _put_component("web_search_provider", bundle.web_search_provider, session)
        await _put_component("image_search_provider", bundle.image_search_provider, session)
        await _apply_draft(bundle.draft_model, session)
        await _apply_groups(bundle, session)
        await _apply_captioning(bundle, session)
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictException("Settings changed during import; try again") from exc
    except Exception:
        await session.rollback()
        raise
    event_bus.emit(NoArgEvent(type=EventType.DRAFT_MODEL_UPDATED))
    logger.info(f"Admin {admin_id} imported application settings with {len(bundle.providers)} providers")
    return summary
