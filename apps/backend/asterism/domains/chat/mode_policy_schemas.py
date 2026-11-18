"""The effective learning-mode policy a chat reports (ADR-0068)."""

from enum import StrEnum

from pydantic import BaseModel, Field

from asterism.domains.agent.learning_inputs import LearningModeId


class ModeReveal(StrEnum):
    """Whether answers may be revealed, weakest restriction first."""

    ALLOWED = "allowed"
    OVERRIDE_REQUIRED = "override_required"
    FORBIDDEN = "forbidden"

    @property
    def rank(self) -> int:
        return list(ModeReveal).index(self)


class ModePolicySourceKind(StrEnum):
    LEARNER = "learner"
    COURSE = "course"


class ModePolicySource(BaseModel):
    """One contributor to the effective policy, and who set it."""

    kind: ModePolicySourceKind
    set_by: str = Field(description="The educator's current name, or 'You' for the learner's lock")
    class_name: str | None = Field(default=None, description="The class, for a course source")
    allowed_modes: list[LearningModeId]
    reveal: ModeReveal
    learner_can_lift: bool


class ModePolicy(BaseModel):
    """What a chat (or a new chat in a project) may do, and why."""

    allowed_modes: list[LearningModeId] = Field(description="Catalog modes every source allows; may be empty")
    reveal: ModeReveal
    sources: list[ModePolicySource] = Field(default_factory=list)

    def source(self, kind: ModePolicySourceKind) -> ModePolicySource | None:
        return next((item for item in self.sources if item.kind == kind), None)
