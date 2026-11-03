"""Inline draft comments from a Draft feedback reply (US-57.2, ADR-0045)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_COMMENTS = 40
MAX_QUOTE_CHARS = 500
MAX_NOTE_CHARS = 1_000


class DraftComment(BaseModel):
    """One quoted passage of the draft and the note about it; stored on the reply."""

    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^c[0-9]{1,3}$")
    criterion: str
    level: str | None = None
    quote: str = Field(min_length=1, max_length=MAX_QUOTE_CHARS)
    note: str = Field(default="", max_length=MAX_NOTE_CHARS)
    resolved_at: int | None = None


class DraftComments(BaseModel):
    """Every comment parsed from one feedback reply, in reply order."""

    model_config = ConfigDict(extra="forbid")
    comments: list[DraftComment] = Field(default_factory=list, max_length=MAX_COMMENTS)


class DraftCommentSummary(BaseModel):
    """Counts shown with the reply; the draft view loads the comments themselves."""

    total: int
    resolved: int


def comment_summary(record: DraftComments | None) -> DraftCommentSummary | None:
    if record is None or not record.comments:
        return None
    return DraftCommentSummary(
        total=len(record.comments), resolved=sum(comment.resolved_at is not None for comment in record.comments)
    )


class DraftAnchor(BaseModel):
    """Where a quote sits in a draft document, as UTF-16 offsets for the browser."""

    document_id: str
    start: int = Field(ge=0)
    end: int = Field(ge=0)


class DraftCommentView(BaseModel):
    id: str
    criterion: str
    level: str | None
    quote: str
    note: str
    resolved: bool
    # None when the quote could not be found in any available document.
    anchor: DraftAnchor | None


class DraftDocument(BaseModel):
    """A part of the draft the feedback turn sent: the message text or an attached file."""

    id: str
    kind: Literal["message", "file"]
    name: str
    available: bool
    # Absent when the document is unavailable or has no text.
    text: str | None = None
    reason: str | None = None


class DraftReview(BaseModel):
    documents: list[DraftDocument]
    comments: list[DraftCommentView]


class DraftCommentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resolved: bool
