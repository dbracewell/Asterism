import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeCaptionMetadata(BaseModel):
    status: str | None = None
    source: str | None = None
    model: str | None = None
    text: str | None = Field(default=None, max_length=10_000)
    error_code: str | None = None
    error_reason: str | None = None
    generated_at: int | None = None
    accepted_at: int | None = None


class FileKnowledgeArtifact(BaseModel):
    """A versioned, file-owned generation of extracted knowledge."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_id: uuid.UUID
    generation: int = Field(ge=1)
    processing_profile_generation: int = Field(ge=1)
    processing_profile_identity: str = Field(min_length=64, max_length=64)
    contract_version: int = Field(ge=1)
    status: Literal["pending", "processing", "ready", "failed", "canceled"]
    is_current: bool
    extracted_content: str | None = None
    chunk_count: int = Field(ge=0)
    text_embeddings_ready: bool
    visual_embedding_ready: bool
    caption: KnowledgeCaptionMetadata
    error_code: str | None = None
    error_reason: str | None = None
    started_at: int | None = None
    completed_at: int | None = None
    created_at: int
    updated_at: int
