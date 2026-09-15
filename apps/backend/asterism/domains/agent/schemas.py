from __future__ import annotations

import uuid
from enum import StrEnum, auto
from typing import Self

from pydantic import BaseModel, ConfigDict, Field

from asterism.core.config import default_allowed_tools
from asterism.domains.llm.schemas import (
    ChatCompletionParams,
    ToolCall,
    ToolResult,
)

from .user_response_queue import UserResponseQueue


class AgentEventType(StrEnum):
    START = auto()
    COMPLETE = auto()
    TOOL_CALL = auto()
    ERROR = auto()
    DELTA = auto()
    TOOL_PERMISSION_REQUEST = auto()


class AgentEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True, arbitrary_types_allowed=True)
    type: AgentEventType
    content: str = Field(default="")
    thinking: str = Field(default="")
    tool_calls: list[ToolCall] = Field(default_factory=list[ToolCall])
    tool_results: list[ToolResult] = Field(default_factory=list[ToolResult])
    total_tokens: int = Field(default=0)
    user_response_queue: UserResponseQueue | None = Field(default=None, exclude=True)

    def has_tool_calls(self) -> bool:
        return len(self.tool_calls) > 0

    def has_tool_results(self) -> bool:
        return len(self.tool_results) > 0


class PartialAgentProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")
    name: str
    description: str
    model_id: uuid.UUID | None
    system_prompt: str | None
    max_steps: int
    chat_parameters: ChatCompletionParams = Field(
        default_factory=ChatCompletionParams,
    )
    tools: list[str] | None = Field(default_factory=default_allowed_tools)
    id: uuid.UUID | None = None

    @classmethod
    def create_default_agent(
        cls,
        model_id: uuid.UUID,
    ) -> Self:
        return cls(
            model_id=model_id,
            max_steps=5,
            description="A default agent to answer the user's requests",
            name="Default agent",
            system_prompt=(
                "You are a helpful agent here to assist "
                "the user in their information needs."
            ),
        )


class AgentProfile(PartialAgentProfile):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID = uuid.uuid4()


class UserAgents(BaseModel):
    agents: dict[uuid.UUID, AgentProfile]
