"""Reuse an image's caption in a new knowledge generation (ADR-0079).

A new generation that changes only how text is embedded (a new embedding model,
extraction or chunking policy) keeps the image's caption: it re-embeds the
caption text instead of captioning the image again. A caption is reused only if
it came from the captioner that is selected now, so changing the captioner
still captions every image again.
"""

import hashlib
import uuid

from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.knowledge.models import (
    FileKnowledgeArtifactModel,
    FileKnowledgeExtractionModel,
    KnowledgeCaptionMode,
    KnowledgeExtractionKind,
    KnowledgeExtractionStatus,
)
from asterism.domains.knowledge.processing_schemas import KnowledgeCaptionConfiguration

# The label local captions record as their model (captioning.py).
LOCAL_CAPTION_MODEL_LABEL = "SmolVLM2"


def caption_payload(row: FileKnowledgeExtractionModel) -> dict[str, JsonValue]:
    """A caption row's payload as a dict (empty when missing or malformed)."""
    return dict(row.payload) if isinstance(row.payload, dict) else {}


def caption_chunk_id(file_id: uuid.UUID | str, generation: int) -> str:
    """The one caption chunk of a file generation."""
    return hashlib.sha256(f"{file_id}:{generation}:caption".encode()).hexdigest()


def captioner_key(mode: str, provider_model_id: uuid.UUID | None) -> str:
    """Identifies a captioner; stored with each caption so a later generation can match it."""
    return f"{mode}:{provider_model_id or ''}"


async def _made_by_current_captioner(
    row: FileKnowledgeExtractionModel,
    configuration: KnowledgeCaptionConfiguration,
    session: AsyncSession,
) -> bool:
    key = caption_payload(row).get("captioner")
    if key is not None:
        return key == captioner_key(configuration.mode, configuration.provider_model_id)
    # Captions from before ADR-0079 record only the mode and a model label.
    if row.provider != configuration.mode:
        return False
    if configuration.mode == KnowledgeCaptionMode.LOCAL.value:
        return row.model == LOCAL_CAPTION_MODEL_LABEL
    from asterism.domains.settings.service import get_model_and_provider

    if configuration.provider_model_id is None:
        return False
    try:
        model = await get_model_and_provider(configuration.provider_model_id, session=session)
    except Exception:
        return False
    return row.model == f"{model.provider.name}/{model.name}"


async def reusable_caption(
    *,
    artifact: FileKnowledgeArtifactModel,
    configuration: KnowledgeCaptionConfiguration,
    session: AsyncSession,
) -> FileKnowledgeExtractionModel | None:
    """The newest ready caption of an earlier generation of this file, if the current captioner made it."""
    if configuration.mode == KnowledgeCaptionMode.DISABLED.value:
        return None
    rows = await session.scalars(
        select(FileKnowledgeExtractionModel)
        .join(FileKnowledgeArtifactModel, FileKnowledgeArtifactModel.id == FileKnowledgeExtractionModel.artifact_id)
        .where(
            FileKnowledgeArtifactModel.file_id == artifact.file_id,
            FileKnowledgeArtifactModel.user_id == artifact.user_id,
            FileKnowledgeArtifactModel.id != artifact.id,
            FileKnowledgeExtractionModel.kind == KnowledgeExtractionKind.CAPTIONING,
            FileKnowledgeExtractionModel.status == KnowledgeExtractionStatus.READY,
        )
        .order_by(FileKnowledgeArtifactModel.generation.desc()),
    )
    for row in rows:
        text = caption_payload(row).get("text")
        if isinstance(text, str) and text.strip() and await _made_by_current_captioner(row, configuration, session):
            return row
    return None
