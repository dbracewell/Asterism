import uuid

from pydantic import BaseModel, ConfigDict, Field

from .models import FileContentStatus, FileKind


class UserFile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    original_name: str
    size: int = Field(ge=0)
    mime_type: str
    kind: FileKind
    content_status: FileContentStatus
    content_error: str | None
    created_at: int
    updated_at: int


class UserFileList(BaseModel):
    files: list[UserFile]
