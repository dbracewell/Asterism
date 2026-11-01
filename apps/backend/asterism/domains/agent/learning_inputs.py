"""Typed learning-mode prompt inputs; the catalog lives in the learning domain."""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from .prompts import PromptLayer

MAX_MODE_INSTRUCTION_CHARS = 16_000


class LearningModeId(StrEnum):
    STANDARD = "standard"
    TUTOR = "tutor"
    EXPLAIN_BACK = "explain_back"
    REVIEW = "review"


class HintLevel(StrEnum):
    """Branch-local hint state, weakest first; ``answer`` is the explicit reveal."""

    NONE = "none"
    NUDGE = "nudge"
    HINT = "hint"
    WORKED_EXAMPLE = "worked_example"
    ANSWER = "answer"

    @property
    def rank(self) -> int:
        return list(HintLevel).index(self)


class FeedbackSectionId(StrEnum):
    """Sections of a structured Explain-back feedback reply, in reply order."""

    CORRECT = "correct"
    GAPS = "gaps"
    FOLLOW_UP = "follow_up"


class LearningModeProvenance(BaseModel):
    """Public identity of the mode a turn ran under; never carries instruction text."""

    model_config = ConfigDict(frozen=True)
    id: LearningModeId
    name: str
    version: int = Field(ge=1)
    # Set only for modes that offer hints; the layer text includes this level.
    hint_level: HintLevel | None = None


class LearningModeSnapshot(LearningModeProvenance):
    """Private pinned instructions; replay reuses them after catalog revisions."""

    instructions: str = Field(max_length=MAX_MODE_INSTRUCTION_CHARS)

    @property
    def identity(self) -> LearningModeProvenance:
        return LearningModeProvenance(id=self.id, name=self.name, version=self.version, hint_level=self.hint_level)

    @property
    def layer(self) -> PromptLayer:
        return PromptLayer(kind="mode", source_id=self.id.value, revision=self.version, text=self.instructions)
