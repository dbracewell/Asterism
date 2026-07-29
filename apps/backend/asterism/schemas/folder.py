from __future__ import annotations

import datetime
import uuid
from typing import TYPE_CHECKING, Optional

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from .chat import ChatInfo


class FlatFolderModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: str
    title: str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    parent_id: Optional[uuid.UUID]
    sessions: list["ChatInfo"] = Field(default_factory=list)


class FolderModel(FlatFolderModel):
    children: list[FolderModel] = Field(default_factory=list)


class FolderModelList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    folders: list[FolderModel]


class NewFolderRequest(BaseModel):
    title: str
    parent_id: uuid.UUID | None = Field(default=None)


class GetFolderRequest(BaseModel):
    id: uuid.UUID
    include_children: bool
