import uuid
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, RootModel


class NewSessionRequest(BaseModel):
    folder_id: Optional[uuid.UUID] = None


class NewSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str


class ChatSessionInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str


class ChatSessionList(RootModel[List[ChatSessionInfo]]):
    model_config = ConfigDict(from_attributes=True)
