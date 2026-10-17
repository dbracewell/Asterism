import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class KnowledgeProcessingProfile(BaseModel):
    """The globally active processing policy recorded by every artifact."""

    model_config = ConfigDict(from_attributes=True)

    generation: int = Field(ge=1)
    identity: str = Field(min_length=64, max_length=64)
    extraction_policy: str = Field(min_length=1, max_length=128)
    chunking_policy: str = Field(min_length=1, max_length=128)
    embedding_model: str = Field(min_length=1, max_length=512)
    captioning_policy: str = Field(min_length=1, max_length=512)
    updated_at: int


class KnowledgeProcessingProfileUpdate(BaseModel):
    extraction_policy: str = Field(min_length=1, max_length=128)
    chunking_policy: str = Field(min_length=1, max_length=128)
    embedding_model: str = Field(min_length=1, max_length=512)
    captioning_policy: str = Field(min_length=1, max_length=512)

    @field_validator("extraction_policy", "chunking_policy", "embedding_model", "captioning_policy")
    @classmethod
    def normalize_policy_identifier(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Policy identifier is required")
        return normalized


class KnowledgeProcessingCaptioningConfiguration(BaseModel):
    """Captioning selection persisted within the knowledge-processing setting."""

    mode: Literal["disabled", "provider", "local"] = "disabled"
    provider_model_id: uuid.UUID | None = None


class KnowledgeProcessingConfiguration(BaseModel):
    """Versioned, persisted value for the ``knowledge.processing`` app setting."""

    schema_version: Literal[1] = 1
    generation: int = Field(default=1, ge=1)
    identity: str = Field(min_length=64, max_length=64)
    extraction_policy: str = Field(min_length=1, max_length=128)
    chunking_policy: str = Field(min_length=1, max_length=128)
    embedding_model: str = Field(min_length=1, max_length=512)
    captioning_policy: str = Field(min_length=1, max_length=512)
    captioning: KnowledgeProcessingCaptioningConfiguration = Field(
        default_factory=KnowledgeProcessingCaptioningConfiguration,
    )

    @field_validator("extraction_policy", "chunking_policy", "embedding_model", "captioning_policy")
    @classmethod
    def normalize_policy_identifier(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Policy identifier is required")
        return normalized


class KnowledgeReprocessSummary(BaseModel):
    profile: KnowledgeProcessingProfile
    queued_file_count: int = Field(ge=0)


class KnowledgeCaptionConfiguration(BaseModel):
    mode: str
    provider_model_id: uuid.UUID | None
    updated_at: int


class KnowledgeCaptionConfigurationUpdate(BaseModel):
    mode: Literal["disabled", "provider", "local"]
    provider_model_id: uuid.UUID | None = None
