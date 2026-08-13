from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field

from asterism.common import (
    LLMMessage,
    MessageStatus,
    ToolCall,
    ToolResult,
)


class MessageModel(LLMMessage):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    status: MessageStatus
    created_at: int
    model_id: uuid.UUID | None = None
    tool_results: list[ToolResult] | None = None
    active_child_id: uuid.UUID | None = None
    has_siblings: bool = False
    sibling_count: int = 0
    current_sibling_index: int = -1


class MessageModelList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    messages: list[MessageModel]


class NewMessage(BaseModel):
    model_id: uuid.UUID
    role: str
    content: str
    token_count: int
    thinking: str = ""
    parent_message_id: uuid.UUID | None = Field(default=None)
    status: MessageStatus | None = Field(default=None)
    tool_calls: list[ToolCall] | None = Field(default=None)
    tool_call_results: list[ToolResult] | None = Field(default=None)


class UpdateMessage(BaseModel):
    content: str | None = Field(default=None)
    thinking: str | None = Field(default=None)
    active_child_id: uuid.UUID | None = Field(default=None)
    status: MessageStatus | None = Field(default=None)
    tool_results: list[ToolResult] | None = Field(default=None)
