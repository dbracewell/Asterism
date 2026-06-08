import uuid

from pydantic import BaseModel


class NewSessionResponse(BaseModel):
    id: uuid.UUID
    title: str


class ChatSessionInfo(BaseModel):
    id: uuid.UUID
    title: str


class ChatSessionList(BaseModel):
    sessions: list[ChatSessionInfo]
