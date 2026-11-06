"""AI-use log contracts (US-57.4, ADR-0046).

The log documents how a learner used AI, from recorded provenance only. It
never claims to detect AI use, and it lists no assistant answer text.
"""

import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

from asterism.domains.agent.learning_inputs import LearningModeProvenance

from .draft_comment_schemas import DraftCommentSummary

MAX_LOG_CHATS = 50


class AiUseLogRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chat_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_LOG_CHATS)

    @field_validator("chat_ids")
    @classmethod
    def _unique(cls, value: list[uuid.UUID]) -> list[uuid.UUID]:
        if len(set(value)) != len(value):
            raise ValueError("chat_ids must not repeat")
        return value


class LoggedFile(BaseModel):
    name: str
    available: bool


class LoggedTemplate(BaseModel):
    name: str
    level: str
    available: bool


class LoggedVerification(BaseModel):
    """Counts of the latest verify pass's claim labels."""

    model: str
    at: int
    supported: int
    unsupported: int
    contradicted: int
    unchecked: int


class LoggedReply(BaseModel):
    message_id: uuid.UUID
    at: int
    status: str
    model: str | None
    # Distinct tools the run called, in first-use order.
    tools: list[str]
    # Files the reply cited (claim citations), by name.
    cited_files: list[str]
    # Spot-the-error answers contain one deliberate error and are always labelled.
    exercise: bool
    verification: LoggedVerification | None
    draft_comments: DraftCommentSummary | None


class LoggedTurn(BaseModel):
    message_id: uuid.UUID
    at: int
    prompt: str
    learning_mode: LearningModeProvenance | None
    persona: str | None
    template: LoggedTemplate | None
    rubric: str | None
    skills: list[str]
    files: list[LoggedFile]
    # Set when the turn was one column of a side-by-side comparison.
    compared: bool
    reply: LoggedReply | None


class LoggedChat(BaseModel):
    chat_id: uuid.UUID
    title: str | None
    project: str | None
    created_at: int
    turns: list[LoggedTurn]


class AiUseLog(BaseModel):
    generated_at: int
    chats: list[LoggedChat]
