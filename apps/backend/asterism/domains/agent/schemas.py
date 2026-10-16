from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import StrEnum, auto

from pydantic import BaseModel, ConfigDict, Field

from asterism.core.config import default_allowed_tools
from asterism.domains.llm.schemas import (
    ChatCompletionParams,
    ToolCall,
    ToolResult,
)

from .context_provenance import ContextProvenance
from .prompts import PromptProvenance


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
    input_tokens: int = Field(default=0)
    output_tokens: int = Field(default=0)
    total_tokens: int = Field(default=0)
    generation_duration_ms: int = Field(default=0)
    sub_agent: SubAgentEventEnvelope | None = None

    def has_tool_calls(self) -> bool:
        return len(self.tool_calls) > 0

    def has_tool_results(self) -> bool:
        return len(self.tool_results) > 0


class AgentProfile(BaseModel):
    """Normalized runtime configuration, separate from public editing contracts."""

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
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    config_revision: int = Field(default=1, ge=1)


class GenerationDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, ge=0, le=1)
    presence_penalty: float | None = Field(default=None, ge=-2, le=2)
    frequency_penalty: float | None = Field(default=None, ge=-2, le=2)
    max_tokens: int | None = Field(default=None, ge=1)
    seed: int | None = None


class MainAgentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    system_prompt: str = ""
    max_steps: int = Field(default=5, ge=1, le=100)
    tools: list[str] = Field(default_factory=list)
    chat_parameters: GenerationDefaults = Field(default_factory=GenerationDefaults)


class MainAgentConfiguration(MainAgentUpdate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    description: str
    config_revision: int = Field(default=1, ge=1)


class SubAgentCreate(MainAgentUpdate):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    model_id: uuid.UUID


class SubAgentDefinition(SubAgentCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    model_available: bool
    config_revision: int = Field(default=1, ge=1)


class UserAgents(BaseModel):
    agents: dict[uuid.UUID, AgentProfile]


class SubAgentTrace(BaseModel):
    context_provenance: ContextProvenance | None = None
    prompt_provenance: PromptProvenance | None = None
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: int
    user_id: str
    parent_message_id: uuid.UUID | None = None
    sub_agent_id: uuid.UUID
    sub_agent_name: str
    task_digest: str
    caller_context_digest: str | None = None
    message_roles: list[str] = Field(default_factory=list)
    result_digest: str | None = None
    step_count: int = 0
    total_tokens: int = 0
    elapsed_ms: int = 0
    depth: int = 0


class SubAgentTraceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    context_provenance: ContextProvenance | None = None
    prompt_provenance: PromptProvenance | None = None
    user_id: str
    parent_message_id: uuid.UUID | None = None
    sub_agent_id: uuid.UUID
    sub_agent_name: str
    task_digest: str
    caller_context_digest: str | None = None
    message_roles: list[str] = Field(default_factory=list)
    result_digest: str | None = None
    step_count: int = 0
    total_tokens: int = 0
    elapsed_ms: int = 0
    depth: int = 0


@dataclass
class ToolUseAuthorization:
    """Result of a tool-use authorization decision."""

    tool: ToolCall
    accept: bool
