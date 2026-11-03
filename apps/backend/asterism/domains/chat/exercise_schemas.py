"""Spot-the-error exercise records (US-55.4, ADR-0043).

``ExerciseRecord`` is stored privately on the message. The API only returns
``ExerciseView``, which omits the error until the learner reveals it.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .citation_schemas import SpanCitation

MAX_ATTEMPTS = 20
MAX_SELECTION_CHARS = 1_000

AttemptResult = Literal["found", "too_broad", "not_it"]


class ExerciseAttempt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selection: str = Field(max_length=MAX_SELECTION_CHARS)
    result: AttemptResult
    at: int = Field(ge=0)


class ExerciseRecord(BaseModel):
    """The deliberate error the model recorded, and the learner's progress.

    ``valid`` is false when the reply had no usable record (missing, unreadable
    or a quote that is not in the answer); the answer is still an exercise.
    """

    model_config = ConfigDict(extra="forbid")
    valid: bool
    quote: str | None = Field(default=None, max_length=1_000)
    correction: str | None = Field(default=None, max_length=1_000)
    # The search result that disproves the error, resolved like a claim citation.
    source: SpanCitation | None = None
    attempts: list[ExerciseAttempt] = Field(default_factory=list, max_length=MAX_ATTEMPTS)
    found: bool = False
    revealed_at: int | None = None


class ExerciseView(BaseModel):
    """What the learner may see: the error only after they reveal it."""

    model_config = ConfigDict(extra="forbid")
    valid: bool
    attempts: list[ExerciseAttempt]
    found: bool
    revealed: bool
    quote: str | None = None
    correction: str | None = None
    source: SpanCitation | None = None


class ExerciseAttemptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selection: str = Field(min_length=1, max_length=MAX_SELECTION_CHARS)


def exercise_view(record: ExerciseRecord | None) -> ExerciseView | None:
    if record is None:
        return None
    revealed = record.revealed_at is not None
    return ExerciseView(
        valid=record.valid,
        attempts=record.attempts,
        found=record.found,
        revealed=revealed,
        quote=record.quote if revealed else None,
        correction=record.correction if revealed else None,
        source=record.source if revealed else None,
    )
