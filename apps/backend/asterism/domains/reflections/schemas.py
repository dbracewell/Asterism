"""Reflection API contracts (US-58.2, ADR-0048)."""

import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_REFLECTION_CHARS = 2_000
MAX_REVISION = 2_147_483_647


class _ReflectionText(BaseModel):
    model_config = ConfigDict(extra="forbid")
    learned: str = Field(default="", max_length=MAX_REFLECTION_CHARS)
    unclear: str = Field(default="", max_length=MAX_REFLECTION_CHARS)

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.learned.strip() and not self.unclear.strip():
            raise ValueError("Write what you learned or what is still unclear")
        if "\x00" in self.learned or "\x00" in self.unclear:
            raise ValueError("Reflections must not contain null characters")
        return self


class ReflectionCreate(_ReflectionText):
    """A reflection on one owned chat; its project and persona come from the chat."""

    chat_id: uuid.UUID


class ReflectionUpdate(_ReflectionText):
    expected_revision: int = Field(ge=1, le=MAX_REVISION)


class Reflection(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    persona_id: uuid.UUID
    project_id: uuid.UUID | None
    chat_id: uuid.UUID | None
    learned: str
    unclear: str
    revision: int
    created_at: int
    updated_at: int


class ReflectionPage(BaseModel):
    items: list[Reflection]
    total: int
    page: int
    page_size: int


class ReflectionDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chat_id: uuid.UUID


class ReflectionDraft(BaseModel):
    """A suggested reflection from the chat; never stored, always edited by the learner."""

    learned: str = Field(max_length=MAX_REFLECTION_CHARS)
    unclear: str = Field(max_length=MAX_REFLECTION_CHARS)
