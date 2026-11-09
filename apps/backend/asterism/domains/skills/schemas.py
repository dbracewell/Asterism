"""Editing and discovery contracts; client payloads never supply derived metadata."""

import uuid
from typing import Literal

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


class SkillDraftStart(BaseModel):
    """Starts a drafting run (ADR-0061); streaming and revisions use the chat API."""

    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    model_id: uuid.UUID
    persona_id: uuid.UUID | None = None
    description: str = Field(min_length=1, max_length=4000)
    examples: str | None = Field(default=None, max_length=8000)


SkillDraftStatus = Literal["none", "pending", "ready", "invalid"]


class SkillDraft(BaseModel):
    """The draft in a drafting chat's latest reply. Never a saved skill."""

    chat_id: uuid.UUID
    status: SkillDraftStatus
    message_id: uuid.UUID | None = None
    content: str | None = None
    name: str | None = None
    description: str | None = None
    error: str | None = None
