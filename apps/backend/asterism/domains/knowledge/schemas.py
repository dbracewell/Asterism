"""The public representation of a knowledge artifact and its derived outputs.

Each derived output of a source file — its text extraction, its embeddings, its
caption — is reported as one entry of the artifact's ``extractions`` map. The
map is keyed by kind, so adding an output does not reshape the artifact.
"""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from .models import KnowledgeExtractionKind, KnowledgeExtractionStatus


class TextExtractionPayload(BaseModel):
    """The text derived from a source file.

    Attributes:
        content: The converted plain text, or ``None`` when the conversion
            produced nothing.
    """

    model_config = ConfigDict(extra="forbid")

    content: str | None = None


class EmbeddingPayload(BaseModel):
    """The embedding state of one source file.

    Attributes:
        text_ready: Whether the text chunks are embedded and searchable.
        visual_ready: Whether the file's visual embedding is ready.
    """

    model_config = ConfigDict(extra="forbid")

    text_ready: bool = False
    visual_ready: bool = False


class CaptioningPayload(BaseModel):
    """The caption derived from an image.

    Attributes:
        text: The caption text, or ``None`` when none was produced.
    """

    model_config = ConfigDict(extra="forbid")

    text: str | None = Field(default=None, max_length=10_000)


class TextExtraction(BaseModel):
    """The text-extraction output of one artifact."""

    kind: Literal[KnowledgeExtractionKind.TEXT_EXTRACTION]
    status: KnowledgeExtractionStatus
    provider: str | None = None
    model: str | None = None
    error_code: str | None = None
    error_reason: str | None = None
    payload: TextExtractionPayload = Field(default_factory=TextExtractionPayload)
    started_at: int | None = None
    completed_at: int | None = None


class Embedding(BaseModel):
    """The embedding output of one artifact."""

    kind: Literal[KnowledgeExtractionKind.EMBEDDING]
    status: KnowledgeExtractionStatus
    provider: str | None = None
    model: str | None = None
    error_code: str | None = None
    error_reason: str | None = None
    payload: EmbeddingPayload = Field(default_factory=EmbeddingPayload)
    started_at: int | None = None
    completed_at: int | None = None


class Captioning(BaseModel):
    """The captioning output of one artifact."""

    kind: Literal[KnowledgeExtractionKind.CAPTIONING]
    status: KnowledgeExtractionStatus
    provider: str | None = None
    model: str | None = None
    error_code: str | None = None
    error_reason: str | None = None
    payload: CaptioningPayload = Field(default_factory=CaptioningPayload)
    started_at: int | None = None
    completed_at: int | None = None


KnowledgeExtraction = Annotated[
    TextExtraction | Embedding | Captioning,
    Field(discriminator="kind"),
]
"""One derived output, discriminated by the kind that produced it."""


class FileKnowledgeArtifact(BaseModel):
    """A versioned, file-owned generation of derived knowledge."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_id: uuid.UUID
    generation: int = Field(ge=1)
    processing_profile_generation: int = Field(ge=1)
    processing_profile_identity: str = Field(min_length=64, max_length=64)
    contract_version: int = Field(ge=1)
    status: KnowledgeExtractionStatus
    is_current: bool
    chunk_count: int = Field(ge=0)
    error_code: str | None = None
    error_reason: str | None = None
    started_at: int | None = None
    completed_at: int | None = None
    created_at: int
    updated_at: int
    extractions: dict[str, KnowledgeExtraction] = Field(default_factory=dict)
    """The artifact's derived outputs, keyed by kind."""
