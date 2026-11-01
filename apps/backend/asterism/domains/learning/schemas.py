from pydantic import BaseModel, Field

from asterism.domains.agent.learning_inputs import HintLevel, LearningModeId


class LearningMode(BaseModel):
    id: LearningModeId
    name: str
    description: str
    version: int = Field(ge=1)
    # Levels the learner can raise to with the hint controls, weakest first.
    hint_levels: list[HintLevel] = Field(default_factory=list)


class LearningModeCatalog(BaseModel):
    modes: list[LearningMode]
