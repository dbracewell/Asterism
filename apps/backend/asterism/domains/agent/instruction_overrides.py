"""Run-only sub-agent instructions for a forked run (US-54.5, ADR-0038).

A fork replaces one sub-agent definition's instructions for that run only. The
text is private to the execution record; public provenance carries a digest.
An override replaces the ``agent`` prompt layer only and grants nothing.
"""

import hashlib
import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field

from asterism.domains.llm.schemas import ToolCall, ToolResult

MAX_OVERRIDE_CHARS = 50_000


def instructions_digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


class InstructionOverrideProvenance(BaseModel):
    """Public record of an override: which definition, at which revision, which text."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    sub_agent_id: uuid.UUID
    base_revision: int = Field(ge=1)
    digest: str


class InstructionOverride(BaseModel):
    """Private override text, written against one revision of a sub-agent definition."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    sub_agent_id: uuid.UUID
    base_revision: int = Field(ge=1)
    instructions: str = Field(max_length=MAX_OVERRIDE_CHARS)

    @property
    def provenance(self) -> InstructionOverrideProvenance:
        return InstructionOverrideProvenance(
            sub_agent_id=self.sub_agent_id,
            base_revision=self.base_revision,
            digest=instructions_digest(self.instructions),
        )


def override_for(overrides: Iterable[InstructionOverride], sub_agent_id: uuid.UUID) -> InstructionOverride | None:
    return next((override for override in overrides if override.sub_agent_id == sub_agent_id), None)


@dataclass(frozen=True)
class ReplayedStep:
    """A recorded main-agent step that a fork starts from instead of calling the model.

    ``reused_results`` are the recorded results kept as they were; every other
    call in ``tool_calls`` runs again.
    """

    content: str
    thinking: str
    tool_calls: list[ToolCall]
    # Recorded results kept as they were, keyed by tool call id.
    reused_results: dict[str, ToolResult]
    # Zero-based index of this step in its run; later steps use the remaining budget.
    step_index: int
