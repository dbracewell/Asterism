"""Derived outputs of a knowledge artifact: payload typing and description.

Every artifact owns at most one extraction row per kind. This module owns the
boundary between the stored rows and the public representation: it validates a
stored payload against the model for its kind, and it builds the artifact's
``extractions`` map.
"""

import uuid
from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    FileKnowledgeArtifactModel,
    FileKnowledgeExtractionModel,
    KnowledgeExtractionKind,
)
from .queries import select_artifact_extractions
from .schemas import (
    Captioning,
    CaptioningPayload,
    Embedding,
    EmbeddingPayload,
    FileKnowledgeArtifact,
    KnowledgeExtraction,
    TextExtraction,
    TextExtractionPayload,
)

_PAYLOAD_MODELS: dict[KnowledgeExtractionKind, type[BaseModel]] = {
    KnowledgeExtractionKind.TEXT_EXTRACTION: TextExtractionPayload,
    KnowledgeExtractionKind.EMBEDDING: EmbeddingPayload,
    KnowledgeExtractionKind.CAPTIONING: CaptioningPayload,
}

_EXTRACTION_MODELS: dict[KnowledgeExtractionKind, type[KnowledgeExtraction]] = {
    KnowledgeExtractionKind.TEXT_EXTRACTION: TextExtraction,
    KnowledgeExtractionKind.EMBEDDING: Embedding,
    KnowledgeExtractionKind.CAPTIONING: Captioning,
}


def validated_payload(kind: KnowledgeExtractionKind, payload: Any) -> BaseModel:
    """Validate a stored payload against the model that belongs to its kind.

    Args:
        kind: The kind the payload belongs to.
        payload: The stored JSON value.

    Returns:
        The validated payload model.

    Raises:
        ValidationError: If the stored payload does not match its kind. A
            corrupt payload fails loudly rather than surfacing as a wrong
            shape.
    """
    return _PAYLOAD_MODELS[kind].model_validate(payload or {})


def describe_extraction(row: FileKnowledgeExtractionModel) -> KnowledgeExtraction:
    """Build the public representation of one derived output.

    Args:
        row: The stored extraction row.

    Returns:
        The validated extraction for the row's kind.
    """
    model = _EXTRACTION_MODELS[row.kind]
    return model.model_validate(
        {
            "kind": row.kind,
            "status": row.status,
            "provider": row.provider,
            "model": row.model,
            "error_code": row.error_code,
            "error_reason": row.error_reason,
            "payload": validated_payload(row.kind, row.payload),
            "started_at": row.started_at,
            "completed_at": row.completed_at,
        }
    )


def describe_artifact(
    artifact: FileKnowledgeArtifactModel,
    extractions: Sequence[FileKnowledgeExtractionModel],
) -> FileKnowledgeArtifact:
    """Build the public representation of one artifact and its outputs.

    Args:
        artifact: The stored artifact row.
        extractions: The artifact's extraction rows.

    Returns:
        The artifact with its ``extractions`` map keyed by kind.
    """
    return FileKnowledgeArtifact.model_validate(artifact).model_copy(
        update={"extractions": {row.kind.value: describe_extraction(row) for row in extractions}}
    )


async def load_extractions(
    *,
    artifact_ids: Sequence[uuid.UUID],
    session: AsyncSession,
) -> dict[uuid.UUID, list[FileKnowledgeExtractionModel]]:
    """Load the extraction rows of several artifacts.

    Args:
        artifact_ids: The artifacts whose outputs are loaded. An empty list
            returns an empty mapping.
        session: Active async session; no commit happens here.

    Returns:
        A mapping of artifact id to its extraction rows.
    """
    if not artifact_ids:
        return {}
    rows = (await session.scalars(select_artifact_extractions(artifact_ids))).all()
    grouped: dict[uuid.UUID, list[FileKnowledgeExtractionModel]] = {}
    for row in rows:
        grouped.setdefault(row.artifact_id, []).append(row)
    return grouped


async def load_artifact_extractions(
    *,
    artifact_id: uuid.UUID,
    session: AsyncSession,
) -> dict[KnowledgeExtractionKind, FileKnowledgeExtractionModel]:
    """Load one artifact's derived outputs, keyed by kind.

    Args:
        artifact_id: The artifact whose outputs are loaded.
        session: Active async session; no commit happens here.

    Returns:
        A mapping of kind to that kind's row. A kind the artifact does not
        have is absent.
    """
    grouped = await load_extractions(artifact_ids=[artifact_id], session=session)
    return {row.kind: row for row in grouped.get(artifact_id, [])}
