"""Wire schemas for course packs. Students never see the educator's record IDs."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .models import MAX_COURSE_NOTE_LENGTH


class CoursePublish(BaseModel):
    """Publish one of the educator's projects as the class's next course version."""

    model_config = ConfigDict(extra="forbid")

    project_id: uuid.UUID
    note: str = Field(default="", max_length=MAX_COURSE_NOTE_LENGTH)


class CourseVersion(BaseModel):
    id: uuid.UUID
    number: int
    note: str
    created_at: int
    sub_agent_names: list[str]
    file_names: list[str]


class CourseVersionPage(BaseModel):
    items: list[CourseVersion]
    total: int
    page: int
    page_size: int


class CourseSubAgent(BaseModel):
    name: str
    description: str
    model_name: str | None = Field(description="None when the model isn't available to you")
    tools: list[str] = Field(description="Tools it will be able to use, after admin policy")


class CourseFile(BaseModel):
    name: str
    size: int


class CourseChange(BaseModel):
    kind: Literal["added", "removed", "changed"]
    item: Literal["settings", "sub_agent", "file"]
    name: str


class CourseCopy(BaseModel):
    version_number: int
    project_id: uuid.UUID | None = Field(description="None if you deleted the course project")


class CourseOffer(BaseModel):
    """What adding or updating the course gives the student, before they agree."""

    version_number: int
    note: str
    published_at: int
    instructions: str
    sub_agents: list[CourseSubAgent]
    files: list[CourseFile]
    current: CourseCopy | None = Field(description="Your copy, or None if you haven't added the course")
    changes: list[CourseChange] = Field(description="Since the version you have; empty when up to date")


class CourseApply(BaseModel):
    """The version the student reviewed; a newer one must be reviewed first."""

    model_config = ConfigDict(extra="forbid")

    version_number: int = Field(ge=1)


class CourseApplied(BaseModel):
    project_id: uuid.UUID
    version_number: int
