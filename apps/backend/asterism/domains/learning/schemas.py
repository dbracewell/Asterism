from pydantic import BaseModel, Field

from asterism.domains.agent.learning_inputs import FeedbackSectionId, HintLevel, LearningModeId


class FeedbackSection(BaseModel):
    id: FeedbackSectionId
    heading: str


class LearningMode(BaseModel):
    id: LearningModeId
    name: str
    description: str
    version: int = Field(ge=1)
    # Levels the learner can raise to with the hint controls, weakest first.
    hint_levels: list[HintLevel] = Field(default_factory=list)
    # Fixed Markdown headings of a structured feedback reply, in order.
    feedback_sections: list[FeedbackSection] = Field(default_factory=list)


class LearningModeCatalog(BaseModel):
    modes: list[LearningMode]
