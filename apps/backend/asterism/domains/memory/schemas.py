"""API contracts for memories. Clients never write the owner, source or revision."""

import unicodedata
import uuid
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import MEMORY_MAX_BYTES, MEMORY_MAX_CHARS, MemoryCategory, MemoryKind, MemorySavedBy

# Revision inputs must fit a portable SQL integer, not an arbitrary JSON integer.
MAX_REVISION = 2_147_483_647


def clean_memory_text(value: str) -> str:
    """Trim, then apply About you's character rules (ADR-0066) within the memory bounds."""
    text = value.strip()
    if not text:
        raise ValueError("A memory needs some text")
    if len(text) > MEMORY_MAX_CHARS:
        raise ValueError(f"A memory can be at most {MEMORY_MAX_CHARS} characters")
    if len(text.encode("utf-8")) > MEMORY_MAX_BYTES:
        raise ValueError(f"A memory can be at most {MEMORY_MAX_BYTES} bytes")
    if any(unicodedata.category(c) == "Cc" and c not in "\n\r\t" for c in text):
        raise ValueError("A memory can't contain control characters other than tab and newlines")
    return text


class _MemoryText(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # The raw bound is generous so the cleaned length decides; the trimmed text is checked.
    text: str = Field(max_length=MEMORY_MAX_CHARS * 2)
    category: MemoryCategory | None = None
    sensitive: bool = False

    @field_validator("text")
    @classmethod
    def valid_text(cls, value: str) -> str:
        return clean_memory_text(value)

    @model_validator(mode="after")
    def accessibility_is_sensitive(self) -> Self:
        # Every accessibility memory is sensitive (ADR-0078).
        if self.category == MemoryCategory.ACCESSIBILITY:
            self.sensitive = True
        return self


class MemoryCreate(_MemoryText):
    kind: MemoryKind
    project_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def scope_matches_kind(self) -> Self:
        if self.kind == MemoryKind.USER:
            if self.project_id is not None:
                raise ValueError("A user memory belongs to no project")
            if self.category is None:
                raise ValueError("A user memory needs a category")
        else:
            if self.project_id is None:
                raise ValueError("A project memory needs a project")
            if self.category is not None:
                raise ValueError("A project memory has no category")
        return self


class MemoryUpdate(_MemoryText):
    """A memory's kind and project never change; text, category and the label do."""

    expected_revision: int = Field(ge=1, le=MAX_REVISION)


class MemorySource(BaseModel):
    """The chat a confirmed proposal came from. ``chat_deleted`` once that chat is gone."""

    chat_id: uuid.UUID | None
    message_id: uuid.UUID | None
    execution_id: uuid.UUID | None
    chat_deleted: bool


class Memory(BaseModel):
    id: uuid.UUID
    kind: MemoryKind
    project_id: uuid.UUID | None
    text: str
    category: MemoryCategory | None
    sensitive: bool
    saved_by: MemorySavedBy
    source: MemorySource
    revision: int
    created_at: int
    updated_at: int


class MemoryPage(BaseModel):
    items: list[Memory]
    total: int
    page: int
    page_size: int


class MemoryDeleteAll(BaseModel):
    deleted: int
