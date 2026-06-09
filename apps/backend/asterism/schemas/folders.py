import uuid
from typing import List, Optional

from openai import BaseModel
from pydantic import ConfigDict, Field, RootModel

from asterism.schemas.chat import ChatSessionInfo


class NewFolderRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    title: str
    parent_folder_id: Optional[uuid.UUID] = None


class FolderResponseFlat(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    sessions: list[ChatSessionInfo] = Field(default_factory=list)
    parent_folder_id: Optional[uuid.UUID] = None


class FolderResponse(FolderResponseFlat):
    children: list["FolderResponse"] = Field(default_factory=list)


class FolderListResponse(RootModel[List[FolderResponse]]):
    pass
