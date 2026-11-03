"""Claim citations resolved at save time (ADR-0040)."""

import uuid

from pydantic import BaseModel, ConfigDict, Field


class SpanCitation(BaseModel):
    """One ``asterism-cite:`` key in saved Markdown, resolved at save time (ADR-0040).

    A key resolves only to a chunk the saving run retrieved from a file still in
    its scope. Unavailable citations carry only ``key``: no file, chunk, name or
    excerpt is ever recorded or returned for them. ``available`` is rechecked
    against live chat scope on read; ``excerpt`` is untrusted retrieved text.
    """

    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=r"^[0-9a-f]{12}$")
    available: bool
    file_id: uuid.UUID | None = None
    chunk_id: str | None = None
    artifact_generation: int | None = Field(default=None, ge=1)
    match_kind: str | None = None
    name: str | None = None
    excerpt: str | None = None
