"""Wire models for groups and membership (ADR-0058)."""

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from .models import MAX_GROUP_NAME_LENGTH

GroupName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_GROUP_NAME_LENGTH)]


class Group(BaseModel):
    """A group and how many users are in it."""

    id: str
    name: str
    built_in: bool = Field(description="Admin, Educator and Student can't be renamed or deleted")
    member_count: int = Field(ge=0)
    models: list[uuid.UUID] | None = Field(
        description="Shared models members may use; null allows every enabled model, including future ones"
    )
    tools: list[str] | None = Field(
        description="Tools members may use; null allows every enabled tool, including future ones"
    )


class GroupAccessUpdate(BaseModel):
    """Replace a group's model and tool access. Null means every enabled one."""

    model_config = ConfigDict(extra="forbid")
    models: list[uuid.UUID] | None = Field(max_length=1000)
    tools: list[str] | None = Field(max_length=200)


class GroupCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: GroupName


class GroupUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: GroupName


class GroupMembershipUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    group_id: str


class GroupRef(BaseModel):
    """The group a user is in, as shown next to them."""

    id: str
    name: str
