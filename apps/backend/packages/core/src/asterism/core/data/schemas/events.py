import uuid

from pydantic import BaseModel


class ChatSessionUpdateEvent(BaseModel):
    session_id: uuid.UUID
    title: str | None = None
    folder_id: uuid.UUID | None = None
