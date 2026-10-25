"""Editing and discovery contracts; client payloads never supply derived metadata."""

import uuid

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from .documents import MAX_DOCUMENT_BYTES

# Revision inputs must fit a portable SQL integer, not an arbitrary JSON integer.
MAX_REVISION = 2_147_483_647


class SkillCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=MAX_DOCUMENT_BYTES)


class SkillUpdate(SkillCreate):
    expected_revision: int = Field(ge=1, le=MAX_REVISION)


class SkillSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    description: str
    revision: int
    created_at: int
    updated_at: int


class Skill(SkillSummary):
    content: str


class SkillPage(BaseModel):
    items: list[SkillSummary]
    total: int
    page: int
    page_size: int


class SkillAssignments(BaseModel):
    skill_ids: list[uuid.UUID]
    revision: int


class SkillAssignmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    skill_ids: list[uuid.UUID] = Field(max_length=100)
    expected_revision: int = Field(ge=1, le=MAX_REVISION)


class SkillPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: StrictBool = False


class EligibleSkillsPage(SkillPage):
    policy_enabled: bool
    agent_revision: int
