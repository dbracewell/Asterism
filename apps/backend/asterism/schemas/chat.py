import uuid

from pydantic import BaseModel


class NewSessionResponse(BaseModel):
    id: uuid.UUID
