"""Processing-policy persistence and validation, independent of worker lifecycles.

The knowledge domain owns the whole processing policy: its schema, its
persistence, and its transitions. This module owns the *state* half — reading
and writing the versioned ``knowledge.processing`` application setting — while
:mod:`asterism.domains.knowledge.processing` owns the *transition* half.

The stored value is an application setting row, so this module reads the
settings domain's table. That is the allowed direction: the knowledge domain
depends on the settings domain, never the other way round.
"""

import hashlib
import json

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException
from asterism.domains.knowledge.caption_schemas import CaptioningConfiguration, CaptioningError, CaptionMode
from asterism.domains.settings.captioning_guard import configure_captioning_selection_guard
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel

from .processing_schemas import (
    KnowledgeCaptionConfiguration,
    KnowledgeProcessingCaptioningConfiguration,
    KnowledgeProcessingConfiguration,
    KnowledgeProcessingProfile,
)

logger = get_logger("KnowledgePolicy")

KNOWLEDGE_PROCESSING_SETTING_KEY = "knowledge.processing"


def processing_identity(
    *,
    extraction_policy: str,
    chunking_policy: str,
    embedding_model: str,
    captioning_policy: str,
    captioning: KnowledgeProcessingCaptioningConfiguration,
) -> str:
    """Fingerprint every input that can change a derived knowledge artifact."""
    content = {
        "extraction_policy": extraction_policy,
        "chunking_policy": chunking_policy,
        "embedding_model": embedding_model,
        "captioning_policy": captioning_policy,
        "captioning": captioning.model_dump(mode="json"),
    }
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def default_processing_configuration() -> KnowledgeProcessingConfiguration:
    """Build the built-in default processing configuration (used when no setting row exists)."""
    captioning = KnowledgeProcessingCaptioningConfiguration()
    return KnowledgeProcessingConfiguration(
        identity=processing_identity(
            extraction_policy="text-extraction-v1",
            chunking_policy="bounded-chunking-v1",
            embedding_model="onnx-clip-v1",
            captioning_policy="captioning-configuration-v1",
            captioning=captioning,
        ),
        extraction_policy="text-extraction-v1",
        chunking_policy="bounded-chunking-v1",
        embedding_model="onnx-clip-v1",
        captioning_policy="captioning-configuration-v1",
        captioning=captioning,
    )


async def load_processing_configuration(
    *,
    session: AsyncSession,
) -> tuple[ApplicationSettingsModel | None, KnowledgeProcessingConfiguration]:
    """Read the versioned setting, falling back safely for missing or invalid values."""
    setting = await session.get(ApplicationSettingsModel, KNOWLEDGE_PROCESSING_SETTING_KEY)
    if setting is None:
        return None, default_processing_configuration()
    try:
        return setting, KnowledgeProcessingConfiguration.model_validate(setting.value)
    except ValidationError as error:
        # Do not make retrieval or file processing unavailable because a manual
        # settings edit is malformed. A subsequent administrator update heals it.
        logger.warning(
            "Stored knowledge processing configuration is invalid; using built-in defaults",
            extra={"error": str(error)},
        )
        return setting, default_processing_configuration()


def profile_from_configuration(
    configuration: KnowledgeProcessingConfiguration,
    *,
    updated_at: int,
) -> KnowledgeProcessingProfile:
    """Project a stored configuration onto the worker-facing processing profile."""
    return KnowledgeProcessingProfile(
        generation=configuration.generation,
        identity=configuration.identity,
        extraction_policy=configuration.extraction_policy,
        chunking_policy=configuration.chunking_policy,
        embedding_model=configuration.embedding_model,
        captioning_policy=configuration.captioning_policy,
        updated_at=updated_at,
    )


def save_processing_configuration(
    *,
    setting: ApplicationSettingsModel | None,
    configuration: KnowledgeProcessingConfiguration,
    session: AsyncSession,
) -> ApplicationSettingsModel:
    """Persist a configuration, creating the setting row on first write.

    The caller owns the transaction (flush/commit).
    """
    if setting is None:
        setting = ApplicationSettingsModel(
            key=KNOWLEDGE_PROCESSING_SETTING_KEY,
            value=configuration.model_dump(mode="json"),
        )
        session.add(setting)
    else:
        setting.value = configuration.model_dump(mode="json")
    return setting


async def get_captioning_configuration(*, session: AsyncSession) -> KnowledgeCaptionConfiguration:
    """Return the captioning mode/model selection with its last-update timestamp (0 when never stored)."""
    setting, configuration = await load_processing_configuration(session=session)
    return KnowledgeCaptionConfiguration(
        mode=configuration.captioning.mode,
        provider_model_id=configuration.captioning.provider_model_id,
        updated_at=setting.updated_at if setting else 0,
    )


async def ensure_captioning_selection_is_valid(*, session: AsyncSession) -> None:
    """Reject a provider/model edit that would orphan the selected captioner.

    Only the selected model row is loaded: :meth:`CaptioningConfiguration.validate`
    inspects nothing else, so scanning the whole catalog here was wasted work.
    The join to the provider mirrors that old scan — a model whose provider row
    was removed earlier in this same transaction counts as gone.
    """
    _, configuration = await load_processing_configuration(session=session)
    provider_model_id = configuration.captioning.provider_model_id
    selected = None
    if provider_model_id is not None:
        selected = await session.scalar(
            select(LLMModel).join(LLMModel.provider).where(LLMModel.id == provider_model_id)
        )
    try:
        CaptioningConfiguration(
            mode=CaptionMode(configuration.captioning.mode),
            provider_model_id=provider_model_id,
        ).validate([selected] if selected is not None else [])
    except CaptioningError as error:
        raise BadDataException(
            "Cannot remove or make ineligible the provider model selected for image captioning",
        ) from error


class _CaptioningSelectionGuard:
    """Adapts the knowledge-domain check to the settings-domain guard interface."""

    async def validate(self, *, session: AsyncSession) -> None:
        await ensure_captioning_selection_is_valid(session=session)


# The settings domain owns the guard interface and calls it before every
# provider or model mutation. Registering here means the protection is active
# wherever the knowledge domain is used, without the settings domain ever
# importing the knowledge package.
configure_captioning_selection_guard(_CaptioningSelectionGuard())
