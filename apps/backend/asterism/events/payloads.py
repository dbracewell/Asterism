import uuid

from pydantic import BaseModel, ConfigDict


class ChatUpdateEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    session_id: uuid.UUID
    title: str | None = None
    folder_id: uuid.UUID | None = None
