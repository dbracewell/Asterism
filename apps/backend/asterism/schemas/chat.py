import datetime
import uuid
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field

from asterism.common import LLMModel

if TYPE_CHECKING:
    from .message import MessageModel


class ChatInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    title: str | None = Field(default=None)
    folder_id: uuid.UUID | None = Field(default=None)


class ChatModel(BaseModel):
    info: ChatInfo
    messages: list["MessageModel"]


class ChatModelList(BaseModel):
    chats: list[ChatInfo]


class NewChatRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_prompt: str
    model: LLMModel
    folder_id: uuid.UUID | None = Field(default=None)


class ChatUpdateRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    title: str | None = Field(default=None)
    folder_id: uuid.UUID | None = Field(default=None)
