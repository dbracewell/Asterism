"""Wire schemas. Student views never hold join codes or rosters."""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints, field_validator

from asterism.domains.agent.learning_inputs import LearningModeId

from .models import MAX_CLASS_DESCRIPTION_LENGTH, MAX_CLASS_NAME_LENGTH, MAX_INVITE_LABEL_LENGTH

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
    allowed_modes: list[LearningModeId] | None
    answer_reveal: bool
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


MAX_INVITES_PER_REQUEST = 50
InviteLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_INVITE_LABEL_LENGTH)]
InviteToken = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]


class ClassInviteCreate(BaseModel):
    """One invite per label, usually one per student."""

    model_config = ConfigDict(extra="forbid")

    labels: list[InviteLabel] = Field(min_length=1, max_length=MAX_INVITES_PER_REQUEST)


class CreatedClassInvite(BaseModel):
    """Returned once, at creation. The token is not stored and can't be shown again."""

    id: uuid.UUID
    label: str
    token: str
    expires_at: int


class CreatedClassInviteList(BaseModel):
    items: list[CreatedClassInvite]


class ClassInvite(BaseModel):
    """The educator's view of an invite, without its token."""

    id: uuid.UUID
    label: str
    status: Literal["unused", "used", "expired", "revoked"]
    expires_at: int
    created_at: int
    redeemed_at: int | None
    redeemed_name: str | None


class ClassInvitePage(BaseModel):
    items: list[ClassInvite]
    total: int
    page: int
    page_size: int


class InviteCheckRequest(BaseModel):
    """Server-to-server: the signup page asks whether an invite can be used."""

    model_config = ConfigDict(extra="forbid")

    token: InviteToken
    system_key: str


class InvitePreview(BaseModel):
    class_name: str
    educator_name: str


class InviteRedeemRequest(BaseModel):
    """Server-to-server: provision a just-created account through an invite."""

    model_config = ConfigDict(extra="forbid")

    token: InviteToken
    user_id: Annotated[str, StringConstraints(min_length=1, max_length=255)]
    display_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    system_key: str


class ClassModePolicy(BaseModel):
    """Narrows learning modes in students' course projects; it never adds anything."""

    model_config = ConfigDict(extra="forbid")

    allowed_modes: list[LearningModeId] | None = Field(
        description="Modes students may use in the course project; null allows all"
    )
    answer_reveal: StrictBool = Field(description="Whether students may reveal answers and solutions")

    @field_validator("allowed_modes")
    @classmethod
    def _at_least_one(cls, value: list[LearningModeId] | None) -> list[LearningModeId] | None:
        if value is not None:
            if not value:
                raise ValueError("Allow at least one mode")
            if len(set(value)) != len(value):
                raise ValueError("List each mode once")
        return value
