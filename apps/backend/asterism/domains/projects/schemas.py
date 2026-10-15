import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic.json_schema import SkipJsonSchema

from asterism.domains.agent.schemas import SubAgentDefinition

ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ProjectName
    description: str = Field(default="", max_length=10_000)
    system_prompt: str = Field(default="", max_length=100_000)


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_context_revision: int = Field(ge=1)
    # None represents omission internally; explicit null remains invalid on the wire.
    name: ProjectName | SkipJsonSchema[None] = None
    description: str | SkipJsonSchema[None] = Field(default=None, max_length=10_000)
    system_prompt: str | SkipJsonSchema[None] = Field(default=None, max_length=100_000)

    @field_validator("name", "description", "system_prompt", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Project fields cannot be null; omit them or use an empty string to clear text")
        return value


class Project(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    system_prompt: str
    context_revision: int = Field(ge=1)
    created_at: int
    updated_at: int


class ProjectList(BaseModel):
    projects: list[Project]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)


class ProjectFileBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_context_revision: int = Field(ge=1)
    file_ids: list[uuid.UUID] = Field(min_length=1, max_length=1000)


class ProjectFileBatchResult(BaseModel):
    context_revision: int = Field(ge=1)
    changed_file_ids: list[uuid.UUID]
    unchanged_file_ids: list[uuid.UUID]


class ProjectSubAgentBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_context_revision: int = Field(ge=1)
    agent_ids: list[uuid.UUID] = Field(min_length=1, max_length=1000)


class ProjectSubAgentBatchResult(BaseModel):
    context_revision: int = Field(ge=1)
    changed_agent_ids: list[uuid.UUID]
    unchanged_agent_ids: list[uuid.UUID]


class ProjectSubAgentList(BaseModel):
    context_revision: int = Field(ge=1)
    agents: list[SubAgentDefinition]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
