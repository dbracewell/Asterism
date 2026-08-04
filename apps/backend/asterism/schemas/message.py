from __future__ import annotations

import uuid
from typing import Annotated, Any, Self

from pydantic import BaseModel, ConfigDict, Field, WithJsonSchema

from asterism.common import (
    LLMModel,
    MessageStatus,
    ToolCall,
    ToolResult,
)


class LLMMessage(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        extra="ignore",
    )
    role: str
    content: str
    token_count: int
    thinking: str | None = Field(default=None)
    tool_calls: list[ToolCall] | None = Field(default=None)

    def to_api_message(self) -> dict[str, Any]:
        if self.role == "tool":
            return {
                "role": self.role,
                "content": self.content,
                "tool_call_id": self.tool_calls[0].id,  # type: ignore
                "name": self.tool_calls[0].function.name,  # type: ignore
            }

        if self.role == "assistant":
            data: dict[str, Any] = {"role": "assistant"}
            if self.content:
                data["content"] = self.content
            if self.tool_calls:
                data["tool_calls"] = [
                    tc.model_dump(mode="json") for tc in self.tool_calls
                ]
            return data

        if not self.content:
            raise RuntimeError(f"Invalid message: {self}")

        return {"role": self.role, "content": self.content}

    @classmethod
    def user(cls, content: str) -> Self:
        return cls(role="user", content=content, token_count=0)

    @classmethod
    def system(cls, content: str) -> Self:
        return cls(role="system", content=content, token_count=0)

    @classmethod
    def tool_call_result(cls, tool_call_result: ToolResult):
        return cls(
            role="tool",
            content=tool_call_result.content,
            token_count=0,
            tool_calls=[tool_call_result.tool_call],
        )

    @classmethod
    def assistant(
        cls,
        content: str,
        token_count: int,
        thinking: str | None = None,
        tool_calls: list[ToolCall] | None = None,
    ) -> Self:
        return cls(
            role="assistant",
            content=content,
            thinking=thinking,
            tool_calls=tool_calls,
            token_count=token_count,
        )


class MessageModel(LLMMessage):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    status: MessageStatus
    created_at: int
    model: LLMModel
    tool_results: list[ToolResult] | None = None
    active_child_id: uuid.UUID | None = None
    has_siblings: bool = False
    sibling_count: int = 0
    current_sibling_index: int = -1


class MessageModelList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    messages: list[MessageModel]


class NewMessage(BaseModel):
    model: LLMModel
    role: str
    content: str
    token_count: int
    thinking: str = ""
    parent_message_id: uuid.UUID | None = None
    status: MessageStatus | None = None
    tool_calls: list[ToolCall] | None = None
    tool_call_results: list[ToolResult] | None = None


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

    tool_results: list[ToolResult] | None = None
