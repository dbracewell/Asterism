from __future__ import annotations

import uuid
from enum import StrEnum, auto

from pydantic import BaseModel, ConfigDict, Field

from asterism.domains.files.models import FileContentStatus, FileKind
from asterism.domains.llm.schemas import LLMMessage, ToolCall, ToolResult


class MessageStatus(StrEnum):
    PENDING = auto()
    COMPLETED = auto()
    CANCELLED = auto()


class MessageFileReference(BaseModel):
    filename: str
    name: str
    mime_type: str
    size: int = Field(ge=0)
    kind: FileKind
    status: FileContentStatus


class NewMessageRequest(BaseModel):
    model_id: uuid.UUID
    role: str
    content: str
    token_count: int = Field(default=0)
    thinking: str = Field(default="")
    parent_message_id: uuid.UUID | None = Field(default=None)
    status: MessageStatus = Field(default=MessageStatus.PENDING)
    tool_calls: list[ToolCall] | None = Field(default=None)
    tool_call_results: list[ToolResult] | None = Field(default=None)
    files: list[MessageFileReference] = Field(default_factory=list)


class Message(LLMMessage):
    model_config = ConfigDict(from_attributes=True)
    # Persisted chat content remains plain text; multimodal parts are runtime-only.
    content: str
    id: uuid.UUID
    status: MessageStatus
    created_at: int
    model_id: uuid.UUID | None = None
    tool_call_results: list[ToolResult] | None = None
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


class ChatInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: str
    created_at: int
    updated_at: int
    allowed_tools: list[str] = Field(default_factory=list)
    title: str | None = Field(default=None)
    folder_id: uuid.UUID | None = Field(default=None)
    agent_id: uuid.UUID | None = Field(default=None)


class ChatInfoList(BaseModel):
    chats: list[ChatInfo]


class SearchResultKind(StrEnum):
    CHAT = auto()
    FOLDER = auto()


class SearchMatchSource(StrEnum):
    TITLE = auto()
    CONTENT = auto()
    FOLDER_TITLE = auto()


class SearchResult(BaseModel):
    kind: SearchResultKind
    id: uuid.UUID
    title: str
    updated_at: int
    folder_id: uuid.UUID | None = None
    match_source: SearchMatchSource
    snippet: str | None = None
    path: list[str] = Field(default_factory=list)


class SearchResultList(BaseModel):
    results: list[SearchResult]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class Chat(BaseModel):
    info: ChatInfo
    messages: list[Message]


class BulkDeleteChatRequest(BaseModel):
    chat_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


class BulkDeleteChatResponse(BaseModel):
    deleted_chat_ids: list[uuid.UUID]


class NewChatRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_prompt: str
    agent_id: uuid.UUID | None = Field(default=None)
    folder_id: uuid.UUID | None = Field(default=None)
    files: list[str] = Field(default_factory=list)


class ChatUpdateRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    title: str | None = Field(default=None)
    folder_id: uuid.UUID | None = Field(default=None)
