"""Collect application settings into an encrypted file (US-63.1).

This is the one path that reads stored keys back out, so it is admin-only and
logged, and its result exists only inside the sealed envelope.
"""

import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.db.mixins import get_unix_timestamp
from asterism.domains.knowledge.policy import load_processing_configuration
from asterism.domains.settings.models import ProviderModel
from asterism.domains.settings.schemas import ComponentProviderParameters
from asterism.domains.settings.service import get_all_providers, get_app_settings

from .documents import (
    ExportedCaptioning,
    ExportedComponent,
    ExportedModel,
    ExportedProvider,
    ModelReference,
    SettingsBundle,
    SettingsEnvelope,
    seal,
)

logger = get_logger("SettingsExport")


def _provider(row: ProviderModel) -> ExportedProvider:
    return ExportedProvider(
        name=row.name,
        provider_type=row.provider_type,
        base_url=row.base_url,
        api_key=row.api_key,
        models=tuple(
            ExportedModel(
                name=model.name,
                display_name=model.display_name,
                is_active=model.is_active,
                context_window=model.context_window,
                supports_vision=model.supports_vision,
                supports_tools=model.supports_tools,
                tools_source=model.tools_source,
                context_window_source=model.context_window_source,
                vision_source=model.vision_source,
                pricing=model.pricing,
            )
            for model in sorted(row.models, key=lambda item: item.name)
        ),
    )


def _component(value: ComponentProviderParameters | None) -> ExportedComponent | None:
    return None if value is None else ExportedComponent(name=value.name, parameters=value.parameters)


def _reference(model_id: uuid.UUID | None, providers: list[ProviderModel]) -> ModelReference | None:
    """A global model's name. A deleted or user-owned model has no portable reference."""
    for provider in providers:
        for model in provider.models:
            if model.id == model_id:
                return ModelReference(provider=provider.name, model=model.name)
    return None


async def collect_settings(session: AsyncSession) -> SettingsBundle:
    settings = await get_app_settings(session)
    providers = await get_all_providers(session)
    _, processing = await load_processing_configuration(session=session)
    return SettingsBundle(
        exported_at=get_unix_timestamp(),
        providers=tuple(_provider(row) for row in sorted(providers, key=lambda item: item.name)),
        draft_model=_reference(settings.draft_model_id, providers),
        active_tools=tuple(settings.active_tools),
        skills_enabled=settings.skills_enabled,
        chatgpt_plan_enabled=settings.chatgpt_plan_enabled,
        web_search_provider=_component(settings.web_search_provider),
        image_search_provider=_component(settings.image_search_provider),
        captioning=ExportedCaptioning(
            mode=processing.captioning.mode,
            model=_reference(processing.captioning.provider_model_id, providers),
        ),
    )


async def export_settings(*, admin_id: str, passphrase: str, session: AsyncSession) -> SettingsEnvelope:
    bundle = await collect_settings(session)
    envelope = await asyncio.to_thread(seal, bundle, passphrase)
    logger.info(f"Admin {admin_id} exported application settings with {len(bundle.providers)} providers")
    return envelope
