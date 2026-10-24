"""Owned persona documents, revisions and default selection contracts."""

import unicodedata
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PersonaInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    user_md: str = Field(default="", max_length=16000)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        value = value.strip()
        if not value or any(unicodedata.category(c).startswith("C") for c in value):
            raise ValueError("Use a nonblank persona name without control characters")
        return value

    @field_validator("user_md")
    @classmethod
    def valid_document(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 64000 or any(
            unicodedata.category(c) == "Cc" and c not in "\n\r\t" for c in value
        ):
            raise ValueError("USER.md must be text without control characters, at most 64000 UTF-8 bytes")
        return value


class PersonaUpdate(PersonaInput):
    expected_revision: int = Field(ge=1)


class PersonaProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    user_md: str
    revision: int
    created_at: int
    updated_at: int
    is_default: bool


class PersonaCollection(BaseModel):
    profiles: list[PersonaProfile]
    default_persona_id: uuid.UUID
    default_revision: int


class PersonaDefaultUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    persona_id: uuid.UUID
    expected_default_revision: int = Field(ge=1)
