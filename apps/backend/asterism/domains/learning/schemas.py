from pydantic import BaseModel, Field

from asterism.domains.agent.learning_inputs import FeedbackSectionId, HintLevel, LearningModeId


class FeedbackSection(BaseModel):
    id: FeedbackSectionId
    heading: str


class RubricFeedbackFormat(BaseModel):
    """Fixed parts of a rubric feedback reply: the level line label and the closing heading."""

    level_label: str
    overall_heading: str


class LearningMode(BaseModel):
    id: LearningModeId
    name: str
    description: str
    version: int = Field(ge=1)
    # Levels the learner can raise to with the hint controls, weakest first.
    hint_levels: list[HintLevel] = Field(default_factory=list)
    # Fixed Markdown headings of a structured feedback reply, in order.
    feedback_sections: list[FeedbackSection] = Field(default_factory=list)
    # Set when turns in this mode take a rubric (US-57.1).
    rubric_feedback: RubricFeedbackFormat | None = None


class LearningModeCatalog(BaseModel):
    modes: list[LearningMode]
