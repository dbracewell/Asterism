from __future__ import annotations

import uuid
from enum import StrEnum, auto
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field

from asterism.core.config import default_allowed_tools
from asterism.domains.llm.schemas import (
    ChatCompletionParams,
    ToolCall,
    ToolResult,
)


class AgentEventType(StrEnum):
    START = auto()
    COMPLETE = auto()
    TOOL_CALL = auto()
    ERROR = auto()
    DELTA = auto()
    TOOL_PERMISSION_REQUEST = auto()
    SUB_AGENT = auto()


class SubAgentEventEnvelope(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    execution_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    sub_agent_id: uuid.UUID
    sub_agent_name: str
    depth: int
    event: AgentEvent


class AgentEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    type: AgentEventType
    content: str = Field(default="")
    thinking: str = Field(default="")
    tool_calls: list[ToolCall] = Field(default_factory=list[ToolCall])
    tool_results: list[ToolResult] = Field(default_factory=list[ToolResult])
    total_tokens: int = Field(default=0)
    sub_agent: SubAgentEventEnvelope | None = None

    def has_tool_calls(self) -> bool:
        return len(self.tool_calls) > 0

    def has_tool_results(self) -> bool:
        return len(self.tool_results) > 0


class PartialAgentProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")
    name: str
    description: str
    sub_agent: bool
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
            sub_agent=False,
            description="A default agent to answer the user's requests",
            name="Default agent",
            system_prompt=("You are a helpful agent here to assist the user in their information needs."),
        )


class AgentProfile(PartialAgentProfile):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID = uuid.uuid4()  # pyright: ignore[reportIncompatibleVariableOverride]


class UserAgents(BaseModel):
    agents: dict[uuid.UUID, AgentProfile]


class SubAgentTrace(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: int
    user_id: str
    parent_message_id: uuid.UUID | None = None
    sub_agent_id: uuid.UUID
    sub_agent_name: str
    prompt: str
    caller_context: str | None = None
    messages: list[dict[str, Any]] = Field(default_factory=list)
    result: str | None = None
    step_count: int = 0
    total_tokens: int = 0
    elapsed_ms: int = 0
    depth: int = 0


class SubAgentTraceCreate(BaseModel):
    user_id: str
    parent_message_id: uuid.UUID | None = None
    sub_agent_id: uuid.UUID
    sub_agent_name: str
    prompt: str
    caller_context: str | None = None
    messages: list[dict[str, Any]] = Field(default_factory=list)
    result: str | None = None
    step_count: int = 0
    total_tokens: int = 0
    elapsed_ms: int = 0
    depth: int = 0
