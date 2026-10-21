"""Schemas for the knowledge-processing policy and its worker-facing profile.

The *policy* describes how source files are turned into knowledge artifacts
(extraction, chunking, embedding, captioning). It is versioned by a
monotonic ``generation`` and fingerprinted by an ``identity`` hash so that a
change can be detected without diffing the whole policy.
"""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class KnowledgeProcessingProfile(BaseModel):
    """The globally active processing policy recorded by every artifact.

    Attributes:
        generation: Monotonic version of the policy. Every artifact records
            the generation it was produced under.
        identity: SHA-256 fingerprint (64 hex characters) of every
            processing-relevant input.
        extraction_policy: Identifier of the text-extraction strategy.
        chunking_policy: Identifier of the chunking strategy.
        embedding_model: Identifier of the embedding model.
        captioning_policy: Identifier of the captioning strategy.
        updated_at: Last-write time of the persisted setting (Unix seconds).
    """

    model_config = ConfigDict(from_attributes=True)

    generation: int = Field(ge=1)
    identity: str = Field(min_length=64, max_length=64)
    extraction_policy: str = Field(min_length=1, max_length=128)
    chunking_policy: str = Field(min_length=1, max_length=128)
    embedding_model: str = Field(min_length=1, max_length=512)
    captioning_policy: str = Field(min_length=1, max_length=512)
    updated_at: int


class KnowledgeProcessingProfileUpdate(BaseModel):
    """Administrator edit of the processing policy.

    Every field is required: an update replaces the policy as a whole rather
    than patching individual keys.

    Attributes:
        extraction_policy: Identifier of the text-extraction strategy.
        chunking_policy: Identifier of the chunking strategy.
        embedding_model: Identifier of the embedding model.
        captioning_policy: Identifier of the captioning strategy.
    """

    extraction_policy: str = Field(min_length=1, max_length=128)
    chunking_policy: str = Field(min_length=1, max_length=128)
    embedding_model: str = Field(min_length=1, max_length=512)
    captioning_policy: str = Field(min_length=1, max_length=512)

    @field_validator("extraction_policy", "chunking_policy", "embedding_model", "captioning_policy")
    @classmethod
    def normalize_policy_identifier(cls, value: str) -> str:
        """Strip surrounding whitespace and reject empty identifiers.

        Args:
            value: Raw identifier as supplied by the client.

        Returns:
            The trimmed identifier.

        Raises:
            ValueError: If the identifier is empty after trimming.
        """
        normalized = value.strip()
        if not normalized:
            raise ValueError("Policy identifier is required")
        return normalized


class KnowledgeProcessingCaptioningConfiguration(BaseModel):
    """Captioning selection persisted within the knowledge-processing setting.

    Attributes:
        mode: One of ``disabled``, ``provider`` or ``local``.
        provider_model_id: Model used for provider-mode captioning, else
            ``None``.
    """

    mode: Literal["disabled", "provider", "local"] = "disabled"
    provider_model_id: uuid.UUID | None = None


class KnowledgeProcessingConfiguration(BaseModel):
    """Versioned, persisted value for the ``knowledge.processing`` app setting.

    Attributes:
        schema_version: Version of this persisted shape (currently ``1``).
        generation: Monotonic policy version; bumped on every real change.
        identity: SHA-256 fingerprint of every processing-relevant input.
        extraction_policy: Identifier of the text-extraction strategy.
        chunking_policy: Identifier of the chunking strategy.
        embedding_model: Identifier of the embedding model.
        captioning_policy: Identifier of the captioning strategy.
        captioning: Captioning selection.
    """

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
        """Strip surrounding whitespace and reject empty identifiers.

        Args:
            value: Raw identifier as supplied by the client.

        Returns:
            The trimmed identifier.

        Raises:
            ValueError: If the identifier is empty after trimming.
        """
        normalized = value.strip()
        if not normalized:
            raise ValueError("Policy identifier is required")
        return normalized


class KnowledgeReprocessSummary(BaseModel):
    """Outcome of a processing-policy transition.

    Attributes:
        profile: The policy that is now active.
        queued_file_count: Number of files whose artifact generation was
            replaced and scheduled for reprocessing.
    """

    profile: KnowledgeProcessingProfile
    queued_file_count: int = Field(ge=0)


class KnowledgeCaptionConfiguration(BaseModel):
    """Captioning selection as reported to administrators.

    Attributes:
        mode: Active captioning mode.
        provider_model_id: Selected provider model, if any.
        updated_at: Last-write time of the persisted setting (Unix seconds),
            or ``0`` when the setting has never been stored.
    """

    mode: str
    provider_model_id: uuid.UUID | None
    updated_at: int


class KnowledgeCaptionConfigurationUpdate(BaseModel):
    """Administrator edit of the captioning selection.

    Attributes:
        mode: Requested captioning mode.
        provider_model_id: Requested provider model; required for
            ``provider`` mode and rejected for ``disabled``.
    """

    mode: Literal["disabled", "provider", "local"]
    provider_model_id: uuid.UUID | None = None
