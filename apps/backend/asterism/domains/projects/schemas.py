"""Pydantic wire schemas for the projects domain.

Request schemas reject unknown fields and explicit nulls; response schemas are
built from ORM rows via ``from_attributes``. Batches carry the client's last
seen ``context_revision`` so services can compare-and-set membership changes.
"""

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic.json_schema import SkipJsonSchema

from asterism.domains.agent.schemas import SubAgentDefinition

# Trimmed, non-empty project name; mirrors the DB check constraint.
ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


class ProjectCreate(BaseModel):
    """Payload for creating a project; description/prompt default to empty text."""

    model_config = ConfigDict(extra="forbid")

    name: ProjectName
    description: str = Field(default="", max_length=10_000)
    system_prompt: str = Field(default="", max_length=100_000)


class ProjectUpdate(BaseModel):
    """Partial project update guarded by an optimistic ``expected_context_revision``.

    Only fields present in the payload are written; omitted fields are untouched.
    An empty string clears text, but explicit JSON null is rejected.
    """

    model_config = ConfigDict(extra="forbid")

    expected_context_revision: int = Field(ge=1)
    # None represents omission internally; explicit null remains invalid on the wire.
    name: ProjectName | SkipJsonSchema[None] = None
    description: str | SkipJsonSchema[None] = Field(default=None, max_length=10_000)
    system_prompt: str | SkipJsonSchema[None] = Field(default=None, max_length=100_000)

    @field_validator("name", "description", "system_prompt", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        """Reject explicit nulls so omission (no key) is the only skip signal."""
        if value is None:
            raise ValueError("Project fields cannot be null; omit them or use an empty string to clear text")
        return value


class Project(BaseModel):
    """Read model for a project, including its current context revision."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    system_prompt: str
    context_revision: int = Field(ge=1)
    created_at: int
    updated_at: int


class ProjectList(BaseModel):
    """One page of projects with the pre-pagination total."""

    projects: list[Project]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)


class ProjectFileBatch(BaseModel):
    """Add/remove batch of file memberships; duplicates are collapsed server-side."""

    model_config = ConfigDict(extra="forbid")

    expected_context_revision: int = Field(ge=1)
    file_ids: list[uuid.UUID] = Field(min_length=1, max_length=1000)


class ProjectFileBatchResult(BaseModel):
    """Outcome of a file batch: the new revision and which ids actually flipped.

    ``changed_file_ids`` are ids whose membership state changed (added or removed);
    ``unchanged_file_ids`` were already in the desired state, so no revision bump.
    """

    context_revision: int = Field(ge=1)
    changed_file_ids: list[uuid.UUID]
    unchanged_file_ids: list[uuid.UUID]


class ProjectSubAgentBatch(BaseModel):
    """Select/deselect batch of sub-agent definitions; duplicates collapsed server-side."""

    model_config = ConfigDict(extra="forbid")

    expected_context_revision: int = Field(ge=1)
    agent_ids: list[uuid.UUID] = Field(min_length=1, max_length=1000)


class ProjectSubAgentBatchResult(BaseModel):
    """Outcome of a sub-agent batch; mirrors :class:`ProjectFileBatchResult`."""

    context_revision: int = Field(ge=1)
    changed_agent_ids: list[uuid.UUID]
    unchanged_agent_ids: list[uuid.UUID]


class ProjectSubAgentList(BaseModel):
    """One page of selected (or candidate) sub-agent definitions for a project.

    ``context_revision`` is the project's revision at read time, so clients can
    pass it back as the expected revision on a subsequent batch write.
    """

    context_revision: int = Field(ge=1)
    agents: list[SubAgentDefinition]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=100)
