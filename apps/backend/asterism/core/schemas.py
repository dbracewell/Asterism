"""Shared core data models: authenticated user, error shape, and documents."""

import uuid
from typing import Literal

from pydantic import BaseModel, Field, JsonValue
from pydantic.dataclasses import dataclass

from .config import config


@dataclass(frozen=True)
class AuthedUser:
    """The authenticated principal resolved from a verified JWT.

    Attributes:
        id: Stable user identifier (JWT ``id`` or ``sub`` claim).
        email: The user's email address.
        name: Display name.
        role: Coarse authorization role; only "user" and "admin" are accepted.
        timezone: IANA timezone string from the profile, if set.
    """

    id: str
    email: str
    name: str
    role: Literal["user", "admin"]
    timezone: str | None = None


class ErrorDetail(BaseModel):
    """Standard error response body: a message plus its HTTP status code."""

    detail: str
    code: int


class NoArgs(BaseModel):
    """Empty payload model for events that carry no data."""


class Document(BaseModel):
    """A unit of retrievable content (e.g., a web page or file excerpt).

    Attributes:
        content: The document text (or raw bytes for binary sources).
        mime_type: MIME type of the content.
        id: Stable identifier, generated if not supplied.
        metadata: Free-form JSON metadata; ``metadata["source"]`` names the origin when present.
    """

    content: str | bytes
    mime_type: str
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    @property
    def source(self) -> str:
        """Human-readable origin: ``metadata["source"]`` when set, else the document id."""
        return str(self.metadata.get("source", self.id))

    def to_llm_context(self) -> str:
        """Render the document as an LLM context block, truncated to the configured retrieval limit.

        Returns:
            A ``source:...\\ncontent:...`` string with content capped at
            ``config.max_chars_for_retrieval`` characters. Note that binary
            (bytes) content is rendered via its ``repr`` and should only be used
            for text documents.
        """
        str_content = self.content[: config.max_chars_for_retrieval] if isinstance(self.content, str) else "<bytes>"
        return f"source:{self.source}\ncontent:{str_content}"
