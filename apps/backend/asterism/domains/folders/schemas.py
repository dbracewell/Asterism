from __future__ import annotations

import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from asterism.domains.chat.schemas import ChatInfo


class FlatFolder(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: str
    title: str
    created_at: int
    updated_at: int
    parent_id: Optional[uuid.UUID]
    sessions: list[ChatInfo] = Field(default_factory=list)


class Folder(FlatFolder):
    children: list[Folder] = Field(default_factory=list)


class FolderList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    folders: list[Folder]


class FolderChatList(BaseModel):
    chats: list[ChatInfo]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class NewFolderRequest(BaseModel):
    title: str
    parent_id: uuid.UUID | None = Field(default=None)


class GetFolderRequest(BaseModel):
    id: uuid.UUID
    include_children: bool
