"""Stored results of an on-demand verify pass over one answer (US-55.2, ADR-0041)."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ClaimLabel = Literal["supported", "unsupported", "contradicted", "unchecked"]

MAX_VERIFY_CLAIMS = 12
MAX_CLAIM_CHARS = 500
MAX_EXPLANATION_CHARS = 600
MAX_EVIDENCE_PER_CLAIM = 4


class ClaimEvidence(BaseModel):
    """A retrieved passage the verifier cited for a claim.

    ``name`` and ``excerpt`` are snapshots of untrusted text; ``available`` is
    rechecked against the live chat scope on read.
    """

    model_config = ConfigDict(extra="forbid")
    file_id: uuid.UUID
    chunk_id: str
    artifact_generation: int = Field(ge=1)
    name: str
    excerpt: str
    available: bool = True


class VerifiedClaim(BaseModel):
    """One factual claim from the answer and its label. Labels never edit the answer."""

    model_config = ConfigDict(extra="forbid")
    claim: str = Field(max_length=MAX_CLAIM_CHARS)
    # Exact text of the answer that states the claim, when the model gave one that matches.
    quote: str | None = Field(default=None, max_length=1_000)
    label: ClaimLabel
    explanation: str | None = Field(default=None, max_length=MAX_EXPLANATION_CHARS)
    evidence: list[ClaimEvidence] = Field(default_factory=list, max_length=MAX_EVIDENCE_PER_CLAIM)


class VerificationUsage(BaseModel):
    """What the pass spent and where it stopped."""

    model_config = ConfigDict(extra="forbid")
    claims_found: int = Field(ge=0)
    claims_checked: int = Field(ge=0)
    claim_limit: int = Field(ge=1)
    # More claims were found than the limit allowed; the rest were not listed.
    claims_truncated: bool = False
    answer_truncated: bool = False
    timed_out: bool = False
    searches: int = Field(default=0, ge=0)
    model_calls: int = Field(default=0, ge=0)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    duration_ms: int = Field(default=0, ge=0)


class MessageVerification(BaseModel):
    """The latest verify pass of one assistant message, with its provenance."""

    model_config = ConfigDict(extra="forbid")
    model_id: uuid.UUID
    model_name: str
    created_at: int = Field(ge=0)
    # The files the pass searched: the answer's recorded scope, narrowed.
    file_ids: list[uuid.UUID]
    claims: list[VerifiedClaim]
    usage: VerificationUsage


class VerifyRequest(BaseModel):
    """Verify an answer with a chosen model, optionally against fewer of its sources."""

    model_config = ConfigDict(extra="forbid")
    model_id: uuid.UUID
    file_ids: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=100)
