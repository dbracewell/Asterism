from __future__ import annotations

import uuid
from typing import Annotated

from pydantic import BaseModel, Field, WithJsonSchema

from asterism.core.data.typedefs.enums import MessageStatus
from asterism.core.llm.tool_registory import ToolCall


class NewMessage(BaseModel):
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
        str | None, WithJsonSchema({"nullable": True, "type": "string"})
    ] = Field(default=None)
    thinking: Annotated[
        str | None, WithJsonSchema({"nullable": True, "type": "string"})
    ] = Field(default=None)
    active_child_id: Annotated[
        uuid.UUID | None, WithJsonSchema({"nullable": True, "type": "string"})
    ] = Field(default=None)
    status: Annotated[
        MessageStatus | None, WithJsonSchema({"nullable": True, "type": "string"})
    ] = Field(default=None)
