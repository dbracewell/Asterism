"""Context manifest recorded with each agent step (US-54.3).

A manifest says what a model was given: references to the prompt layers it
was composed from, the attached files and how each was included, the
retrieved chunks, and anything truncated or omitted, with the reason. It holds
references, never content. Layer text stays in the private prompt snapshot,
which only the owner can read, and retrieved excerpts stay in the persisted
tool results, which are untrusted.
"""

import uuid
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from asterism.domains.prompt_templates.provenance import TemplateProvenance

from .prompts import LayerKind, PromptSnapshot


class ContextLayer(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: LayerKind
    source_id: str
    revision: int
    digest: str
    characters: int = Field(ge=0)


class FileInclusion(StrEnum):
    TEXT = "text"
    IMAGE = "image"
    OMITTED = "omitted"


class ContextFile(BaseModel):
    """A file attached on the active branch and what the model received of it."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    file_id: uuid.UUID
    # Untrusted owner text; render as text.
    name: str
    inclusion: FileInclusion
    reason: str | None = None


class ContextChunk(BaseModel):
    """A retrieved chunk reference; its excerpt lives in the step's tool result."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    tool_call_id: str
    file_id: uuid.UUID
    chunk_id: str
    artifact_generation: int
    score: float
    truncated: bool = False


class OmissionKind(StrEnum):
    """Omitted attached files carry their reason on ``ContextFile`` instead."""

    RUNTIME_INSTRUCTIONS = "runtime_instructions"
    RETRIEVAL = "retrieval"
    RETRIEVED_EXCERPT = "retrieved_excerpt"
    FORWARDED_CONTEXT = "forwarded_context"


class ContextOmission(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: OmissionKind
    # File id, tool call id, or None when the omission is not about one item.
    subject: str | None = None
    reason: str = Field(max_length=500)


class ContextManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    layers: list[ContextLayer] = Field(default_factory=list)
    template: TemplateProvenance | None = None
    files: list[ContextFile] = Field(default_factory=list)
    chunks: list[ContextChunk] = Field(default_factory=list)
    omissions: list[ContextOmission] = Field(default_factory=list)


def layer_references(snapshot: PromptSnapshot) -> list[ContextLayer]:
    """References to every layer in a prompt snapshot, without their text."""
    return [
        ContextLayer(
            kind=source.kind,
            source_id=source.source_id,
            revision=source.revision,
            digest=source.digest,
            characters=len(layer.text),
        )
        for source, layer in zip(snapshot.provenance.sources, snapshot.layers, strict=True)
    ]


def runtime_omissions(snapshot: PromptSnapshot) -> list[ContextOmission]:
    if not snapshot.runtime_truncated:
        return []
    return [
        ContextOmission(
            kind=OmissionKind.RUNTIME_INSTRUCTIONS,
            reason="Runtime details were cut to fit the instruction size limit.",
        )
    ]
