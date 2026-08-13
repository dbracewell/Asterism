import uuid

from pydantic import BaseModel, Field, JsonValue

from asterism.config import config


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
            f"content:{self.content[: config.MAX_CHARS_FOR_RETRIEVAL]}"
        )
