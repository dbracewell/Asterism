"""Wire schemas. Student views never hold join codes or rosters."""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints

from .models import MAX_CLASS_DESCRIPTION_LENGTH, MAX_CLASS_NAME_LENGTH

ClassName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_CLASS_NAME_LENGTH)]


class EducatorAccess(BaseModel):
    status: Literal["none", "pending", "approved"]


class EducatorRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    status: Literal["pending", "approved"]
    display_name: str
    email: str
    created_at: int


class EducatorRequestPage(BaseModel):
    items: list[EducatorRequest]
    total: int
    page: int
    page_size: int


class ClassCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ClassName
    description: str = Field(default="", max_length=MAX_CLASS_DESCRIPTION_LENGTH)


class ClassUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ClassName | None = None
    description: str | None = Field(default=None, max_length=MAX_CLASS_DESCRIPTION_LENGTH)
    join_enabled: StrictBool | None = None


class TaughtClass(BaseModel):
    """The educator's view."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    join_code: str
    join_enabled: bool
    member_count: int = 0
    created_at: int


class TaughtClassPage(BaseModel):
    items: list[TaughtClass]
    total: int
    page: int
    page_size: int


class ClassMember(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    display_name: str
    removed_at: int | None
    created_at: int


class ClassMemberPage(BaseModel):
    items: list[ClassMember]
    total: int
    page: int
    page_size: int


class ClassJoinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=32)


class JoinedClass(BaseModel):
    """The student's view: who runs the class, and nothing about classmates."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    educator_name: str


class JoinedClassPage(BaseModel):
    items: list[JoinedClass]
    total: int
    page: int
    page_size: int
