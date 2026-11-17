"""About you contracts: one text per user, edited with an expected revision (ADR-0066)."""

import unicodedata

from pydantic import BaseModel, ConfigDict, Field, field_validator

from asterism.domains.agent.prompts import ABOUT_MAX_BYTES, ABOUT_MAX_CHARS


class AboutYou(BaseModel):
    """What the user wrote about themselves, and its current revision."""

    model_config = ConfigDict(from_attributes=True)
    about_md: str
    revision: int = Field(ge=1)


class AboutYouUpdate(BaseModel):
    """Replace the About you text; fails with 409 when ``expected_revision`` is stale."""

    model_config = ConfigDict(extra="forbid")
    about_md: str = Field(default="", max_length=ABOUT_MAX_CHARS)
    expected_revision: int = Field(ge=1)

    @field_validator("about_md")
    @classmethod
    def valid_text(cls, value: str) -> str:
        if len(value.encode("utf-8")) > ABOUT_MAX_BYTES or any(
            unicodedata.category(c) == "Cc" and c not in "\n\r\t" for c in value
        ):
            raise ValueError(
                f"About you must be text without control characters, at most {ABOUT_MAX_BYTES} UTF-8 bytes"
            )
        return value
