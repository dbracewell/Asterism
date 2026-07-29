from __future__ import annotations

import uuid
from typing import Annotated

from pydantic import BaseModel, Field, WithJsonSchema

from asterism.core.models.common import LLMModel
from asterism.core.models.message import MessageStatus
from asterism.core.registries.tool import ToolCall


class NewMessage(BaseModel):
    model: LLMModel
    role: str
    content: str
    token_count: int
    thinking: str = ""
    parent_message_id: uuid.UUID | None = None
    status: MessageStatus | None = None
    tool_call_id: str | None = None
    tool_calls: list[ToolCall] | None = None


class UpdateMessage(BaseModel):
    content: Annotated[
        str | None,
        WithJsonSchema(
            {
                "anyOf": [{"type": "string"}, {"type": "null"}],
            }
        ),
    ] = Field(default=None)
    thinking: Annotated[
        str | None,
        WithJsonSchema(
            {
                "anyOf": [{"type": "string"}, {"type": "null"}],
            }
        ),
    ] = Field(default=None)
    active_child_id: Annotated[
        uuid.UUID | None,
        WithJsonSchema(
            {
                "anyOf": [{"type": "string"}, {"type": "null"}],
            }
        ),
    ] = Field(default=None)
    status: Annotated[
        MessageStatus | None,
        WithJsonSchema(
            {
                "anyOf": [{"type": "string"}, {"type": "null"}],
            }
        ),
    ] = Field(default=None)
