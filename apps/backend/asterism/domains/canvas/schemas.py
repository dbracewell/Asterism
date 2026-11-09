"""Canvas contracts (ADR-0063). Content is untrusted text and grants nothing."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool

CanvasKind = Literal["document", "code", "html"]
CanvasAuthor = Literal["agent", "user"]

MAX_CONTENT_BYTES = 262_144
MAX_TITLE_LENGTH = 200
MAX_ITEMS_PER_CHAT = 50
MAX_VERSIONS_PER_ITEM = 200
MAX_EDITS = 50


class CanvasPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: StrictBool = False


class CanvasItemSummary(BaseModel):
    """An item as it stands on one branch: its current visible version."""

    id: uuid.UUID
    kind: CanvasKind
    language: str
    title: str
    version: int
    author: CanvasAuthor
    size: int = Field(description="Current content size in UTF-8 bytes")
    updated_at: int


class CanvasVersionSummary(BaseModel):
    number: int
    title: str
    author: CanvasAuthor
    message_id: uuid.UUID
    size: int
    created_at: int


class CanvasItemHistory(BaseModel):
    """An item and its versions visible on the chat's active branch, oldest first."""

    id: uuid.UUID
    kind: CanvasKind
    language: str
    versions: list[CanvasVersionSummary]


class CanvasVersion(CanvasVersionSummary):
    item_id: uuid.UUID
    kind: CanvasKind
    language: str
    content: str
