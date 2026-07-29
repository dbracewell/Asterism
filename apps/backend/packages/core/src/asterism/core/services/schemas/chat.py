from __future__ import annotations

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, WithJsonSchema

from asterism.core.models.common import LLMModel


class NewChatRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_prompt: str
    model: LLMModel
    folder_id: uuid.UUID | None = Field(default=None)


class ChatUpdateRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    title: Annotated[str | None, WithJsonSchema({"nullable": True})] = Field(
        default=None
    )
    folder_id: Annotated[uuid.UUID | None, WithJsonSchema({"nullable": True})] = Field(
        default=None
    )
