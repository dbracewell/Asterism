from pydantic import BaseModel, Field

from asterism.domains.agent.learning_inputs import LearningModeId


class LearningMode(BaseModel):
    id: LearningModeId
    name: str
    description: str
    version: int = Field(ge=1)


class LearningModeCatalog(BaseModel):
    modes: list[LearningMode]
