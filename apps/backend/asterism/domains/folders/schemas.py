from __future__ import annotations

import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class FlatFolder(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: str
    title: str
    created_at: int
    updated_at: int
    parent_id: Optional[uuid.UUID]


class Folder(FlatFolder):
    children: list[Folder] = Field(default_factory=list)


class FolderList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    folders: list[Folder]


class NewFolderRequest(BaseModel):
    title: str
    parent_id: uuid.UUID | None = Field(default=None)


class GetFolderRequest(BaseModel):
    id: uuid.UUID
    include_children: bool
