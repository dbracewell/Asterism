from __future__ import annotations

import uuid
from enum import StrEnum, auto
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from asterism.domains.agent.context_provenance import ContextProvenance
from asterism.domains.agent.prompts import PersonaProvenance, PromptProvenance
from asterism.domains.agent.schemas import MainAgentConfiguration
from asterism.domains.agent.skill_inputs import SkillIdentity
from asterism.domains.files.models import FileContentStatus, FileKind
from asterism.domains.llm.schemas import LLMMessage, ToolCall, ToolResult
from asterism.domains.settings.provider_types import ModelCapabilitySource, ProviderType


class MessageStatus(StrEnum):
    PENDING = auto()
    COMPLETED = auto()
    CANCELLED = auto()


DelegationStatus = Literal["running", "completed", "error", "cancelled"]


class DelegationRecord(BaseModel):
    """One sub-agent delegation observed during an assistant step.

    Persisted on the assistant message whose tool calls ran it, for history
    display only: identity, the fixed model that ran, timing, the child's own
    tool calls and results, and its output or error. Thinking and prompts are not kept.
    """

    model_config = ConfigDict(extra="forbid")
    execution_id: uuid.UUID
    parent_execution_id: uuid.UUID | None = None
    sub_agent_id: uuid.UUID
    name: str
    model_name: str | None = None
    depth: int = Field(ge=0)
    status: DelegationStatus
    started_at_ms: int = Field(ge=0)
    ended_at_ms: int = Field(ge=0)
    tool_calls: list[ToolCall] = Field(default_factory=list)
    tool_results: list[ToolResult] = Field(default_factory=list)
    output: str = ""
    error: str | None = None


class MessageFileReference(BaseModel):
    file_id: uuid.UUID
    filename: str
    name: str
    mime_type: str
    size: int = Field(ge=0)
    kind: FileKind
    status: FileContentStatus
    available: bool = True


class ChatModelChoice(BaseModel):
    id: uuid.UUID
    name: str
    display_name: str | None = None
    provider_id: uuid.UUID
    provider_name: str
    provider_type: ProviderType
    available: bool
    enabled: bool = True
    authorized: bool = True
    unavailable_reason: str | None = None
    # Stable code for plan recovery UI, e.g. ``chatgpt_plan_usage_limit``.
    unavailable_code: str | None = None
    context_window: int | None = None
    context_window_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    supports_vision: bool | None = None
    supports_tools: bool | None = None


class SkillSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0, le=2_147_483_647)
    skill_ids: list[uuid.UUID] = Field(max_length=8)
    refresh_ids: list[uuid.UUID] = Field(default_factory=list, max_length=8)


class ActiveSkill(SkillIdentity):
    available: bool = True
    update_available: bool = False


class ActiveSkillState(BaseModel):
    revision: int = Field(default=0, ge=0)
    skills: list[ActiveSkill] = Field(default_factory=list)


class MessageExecution(BaseModel):
    skills: list[SkillIdentity] = Field(default_factory=list)
    persona: PersonaProvenance
    context: ContextProvenance | None = None
    prompt: PromptProvenance = Field(default_factory=PromptProvenance)
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    request_message_id: uuid.UUID
    model: ChatModelChoice
    model_revision: int = Field(ge=1)
    configuration: MainAgentConfiguration


class ChatModelUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: uuid.UUID
    expected_model_revision: int = Field(ge=1)


class NewMessageRequest(BaseModel):
    execution: MessageExecution | None = None
    model_id: uuid.UUID
    role: str
    content: str
    input_tokens: int = Field(default=0)
    output_tokens: int = Field(default=0)
    total_tokens: int = Field(default=0)
    generation_duration_ms: int = Field(default=0)
    thinking: str = Field(default="")
    parent_message_id: uuid.UUID | None = Field(default=None)
    status: MessageStatus = Field(default=MessageStatus.PENDING)
    tool_calls: list[ToolCall] | None = Field(default=None)
    tool_call_results: list[ToolResult] | None = Field(default=None)
    delegations: list[DelegationRecord] | None = Field(default=None)
    files: list[uuid.UUID] = Field(default_factory=list, max_length=100)


class Message(LLMMessage):
    skills: list[SkillIdentity] = Field(default_factory=list)
    execution: MessageExecution | None = None
    model_config = ConfigDict(from_attributes=True)
    # Persisted chat content remains plain text; multimodal parts are runtime-only.
    content: str  # type: ignore[reportIncompatibleVariableOverride] - persisted messages are text only
    id: uuid.UUID
    status: MessageStatus
    created_at: int
    model_id: uuid.UUID | None = None
    input_tokens: int = Field(default=0)
    output_tokens: int = Field(default=0)
    total_tokens: int = Field(default=0)
    generation_duration_ms: int = Field(default=0)
    tool_call_results: list[ToolResult] | None = None
    delegations: list[DelegationRecord] | None = None
    files: list[MessageFileReference] = Field(default_factory=list)
    active_child_id: uuid.UUID | None = None
    has_siblings: bool = False
    sibling_count: int = 0
    current_sibling_index: int = -1
    parent_message_id: uuid.UUID | None = None
    next_sibling_id: uuid.UUID | None = None
    previous_sibling_id: uuid.UUID | None = None


class MessageList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    messages: list[Message]


class UpdateMessageRequest(BaseModel):
    content: str | None = Field(default=None)
    thinking: str | None = Field(default=None)
    active_child_id: uuid.UUID | None = Field(default=None)
    status: MessageStatus | None = Field(default=None)
    tool_results: list[ToolResult] | None = Field(default=None)
    tool_call_results: list[ToolResult] | None = Field(default=None)


class ChatContextModel(BaseModel):
    id: uuid.UUID
    name: str
    context_window: int | None = None
    context_window_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN


class ChatContextUsage(BaseModel):
    input_tokens: int = Field(ge=0)
    reserved_output_tokens: int | None = Field(default=None, ge=0)
    total_tokens: int = Field(ge=0)
    estimated: bool = True


class ChatInfo(BaseModel):
    active_skills: ActiveSkillState = Field(default_factory=ActiveSkillState)
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: str
    created_at: int
    updated_at: int
    allowed_tools: list[str] = Field(default_factory=list)
    title: str | None = Field(default=None)
    project_id: uuid.UUID | None = Field(default=None)
    agent_id: uuid.UUID | None = Field(default=None)
    preview: str | None = Field(default=None)
    message_count: int | None = Field(default=None)
    context_model: ChatContextModel | None = Field(default=None)
    persona_id: uuid.UUID | None = None
    persona_revision: int = Field(default=1, ge=1)
    selected_model_id: uuid.UUID | None = None
    model_revision: int = Field(default=1, ge=1)
    selected_model: ChatModelChoice | None = None
    pending_execution: MessageExecution | None = None
    pending_persona: PersonaProvenance | None = None
    resume_error: str | None = None


class ChatInfoList(BaseModel):
    chats: list[ChatInfo]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class SearchResultKind(StrEnum):
    CHAT = auto()
    PROJECT = auto()


class SearchMatchSource(StrEnum):
    TITLE = auto()
    CONTENT = auto()
    PROJECT_NAME = auto()
    PROJECT_DESCRIPTION = auto()


class SearchResult(BaseModel):
    kind: SearchResultKind
    id: uuid.UUID
    title: str
    updated_at: int
    project_id: uuid.UUID | None = None
    project_name: str | None = None
    match_source: SearchMatchSource
    snippet: str | None = None


class SearchResultList(BaseModel):
    results: list[SearchResult]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class Chat(BaseModel):
    info: ChatInfo
    messages: list[Message]
    context_usage: ChatContextUsage | None = None


class BulkDeleteChatRequest(BaseModel):
    chat_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


class BulkDeleteChatResponse(BaseModel):
    deleted_chat_ids: list[uuid.UUID]


class NewChatRequest(BaseModel):
    skills: SkillSelection | None = None
    persona_id: uuid.UUID | None = None
    model_id: uuid.UUID
    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    draft_id: uuid.UUID | None = None
    user_prompt: str
    project_id: uuid.UUID | None = Field(default=None)
    files: list[uuid.UUID] = Field(default_factory=list, max_length=100)


class ChatUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None)


class ChatMoveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: uuid.UUID | None


class ScopedChatFile(BaseModel):
    file_id: uuid.UUID
    sources: list[Literal["project", "chat"]]
    message_ids: list[uuid.UUID] = Field(default_factory=list)


class ChatFileScope(BaseModel):
    chat_id: uuid.UUID
    project_id: uuid.UUID | None
    project_context_revision: int | None = None
    project_system_prompt: str = ""
    allowed_file_ids: list[uuid.UUID]
    files: list[ScopedChatFile]
    unavailable_file_ids: list[uuid.UUID]


class ChatDraftCreate(BaseModel):
    model_id: uuid.UUID | None = None
    model_config = ConfigDict(extra="forbid")
    chat_id: uuid.UUID | None = None


class ChatDraftFiles(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_ids: list[uuid.UUID] = Field(max_length=100)


class ChatDraft(BaseModel):
    model_id: uuid.UUID | None = None
    id: uuid.UUID
    chat_id: uuid.UUID | None
    expires_at: int
    file_ids: list[uuid.UUID]
    unavailable_file_ids: list[uuid.UUID]


class ChatSendRequest(BaseModel):
    skills: SkillSelection | None = None
    expected_model_revision: int = Field(ge=1)
    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    user_prompt: str
    parent_message_id: uuid.UUID | None
    draft_id: uuid.UUID | None = None
    files: list[uuid.UUID] = Field(default_factory=list, max_length=100)


class ChatDraftModelUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: uuid.UUID | None
    expected_model_id: uuid.UUID | None


class ChatPersonaUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    persona_id: uuid.UUID | None
    expected_persona_revision: int = Field(ge=1)
