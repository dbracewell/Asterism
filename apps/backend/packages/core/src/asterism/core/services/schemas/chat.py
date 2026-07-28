from __future__ import annotations

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, WithJsonSchema


class NewChatRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_prompt: str
    folder_id: Annotated[
        uuid.UUID | None,
        WithJsonSchema(
            {
                "anyOf": [{"type": "string"}, {"type": "null"}],
            }
        ),
    ] = Field(default=None)


class ChatUpdateRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    title: Annotated[str | None, WithJsonSchema({"nullable": True})] = Field(
        default=None
    )
    folder_id: Annotated[uuid.UUID | None, WithJsonSchema({"nullable": True})] = Field(
        default=None
    )
