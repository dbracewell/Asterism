import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeBaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)


class KnowledgeBaseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)


class KnowledgeBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    created_at: int
    updated_at: int


class KnowledgeBaseList(BaseModel):
    knowledge_bases: list[KnowledgeBase]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class KnowledgeProcessingProfile(BaseModel):
    """The globally active processing policy recorded by every artifact."""

    generation: int = Field(ge=1)
    identity: str = Field(min_length=64, max_length=64)
    extraction_policy: str = Field(min_length=1, max_length=128)
    chunking_policy: str = Field(min_length=1, max_length=128)
    embedding_model: str = Field(min_length=1, max_length=512)
    captioning_policy: str = Field(min_length=1, max_length=512)
    updated_at: int


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
    caption: "KnowledgeCaptionMetadata"
    error_code: str | None = None
    error_reason: str | None = None
    started_at: int | None = None
    completed_at: int | None = None
    created_at: int
    updated_at: int


class KnowledgeBaseFile(BaseModel):
    """A knowledge base's reference to a file already owned by the user."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    knowledge_base_id: uuid.UUID
    file_id: uuid.UUID
    position: int = Field(ge=0)
    created_at: int
    updated_at: int


class KnowledgeBaseFileCreate(BaseModel):
    file_id: uuid.UUID


class KnowledgeBaseFileList(BaseModel):
    files: list[KnowledgeBaseFile]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class KnowledgeCaptionMetadata(BaseModel):
    status: str | None = None
    source: str | None = None
    model: str | None = None
    text: str | None = Field(default=None, max_length=10_000)
    error_code: str | None = None
    error_reason: str | None = None
    generated_at: int | None = None
    accepted_at: int | None = None


class KnowledgeCaptionUpdate(BaseModel):
    text: str | None = Field(default=None, max_length=10_000)
    accept: bool = False
    clear: bool = False


class KnowledgeCaptionConfiguration(BaseModel):
    mode: str
    provider_model_id: uuid.UUID | None
    updated_at: int


class KnowledgeCaptionConfigurationUpdate(BaseModel):
    mode: Literal["disabled", "provider", "local"]
    provider_model_id: uuid.UUID | None = None


class KnowledgeBaseAssignmentReplace(BaseModel):
    knowledge_base_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)


class KnowledgeBaseAssignmentList(BaseModel):
    knowledge_base_ids: list[uuid.UUID]
