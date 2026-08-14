import uuid
from typing import Literal

from pydantic import BaseModel, Field, JsonValue
from pydantic.dataclasses import dataclass

from .config import config


@dataclass(frozen=True)
class AuthedUser:
    id: str
    email: str
    name: str
    role: Literal["user", "admin"]
    timezone: str | None = None


class ErrorDetail(BaseModel):
    detail: str
    code: int


class NoArgs(BaseModel):
    pass


class Document(BaseModel):
    content: str | bytes
    mime_type: str
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    @property
    def source(self) -> str:
        return str(self.metadata.get("source", self.id))

    def to_llm_context(self):
        return (
            f"source:{self.source}\n"
            f"content:{self.content[: config.max_chars_for_retrieval]}"
        )
