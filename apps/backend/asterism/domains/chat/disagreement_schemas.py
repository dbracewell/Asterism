"""Stored results of a disagreement pass over comparison columns or sub-agent outputs (US-55.3)."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_DISAGREEMENTS = 8
MAX_DELEGATION_SOURCES = 6
MAX_TOPIC_CHARS = 200
MAX_POSITION_CHARS = 400


class DisagreementSource(BaseModel):
    """One compared answer: a comparison column's final reply or one agent's output.

    ``message_id`` is the reply a column contributed, so a summary can be shown
    as out of date once the column's answer changes.
    """

    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=r"^S\d{1,2}$")
    kind: Literal["column", "agent"]
    label: str = Field(max_length=120)
    column_index: int | None = None
    message_id: uuid.UUID | None = None
    delegation_execution_id: uuid.UUID | None = None
    # The answer was longer than the pass reads; only its beginning was compared.
    truncated: bool = False


class DisagreementPosition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(pattern=r"^S\d{1,2}$")
    claim: str = Field(max_length=MAX_POSITION_CHARS)


class Disagreement(BaseModel):
    """A point the sources cannot all be right about; positions come from distinct sources."""

    model_config = ConfigDict(extra="forbid")
    topic: str = Field(max_length=MAX_TOPIC_CHARS)
    positions: list[DisagreementPosition] = Field(min_length=2, max_length=MAX_DELEGATION_SOURCES)


class DisagreementUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # More disagreements were listed than the limit; the rest were dropped.
    truncated: bool = False
    limit: int = Field(ge=1)
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    duration_ms: int = Field(ge=0)


class DisagreementSummary(BaseModel):
    """The latest disagreement pass, with its provenance. It never changes the answers."""

    model_config = ConfigDict(extra="forbid")
    model_id: uuid.UUID
    model_name: str
    created_at: int = Field(ge=0)
    sources: list[DisagreementSource] = Field(min_length=2)
    disagreements: list[Disagreement]
    usage: DisagreementUsage


class DisagreementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: uuid.UUID
