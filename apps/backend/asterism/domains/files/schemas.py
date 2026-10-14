import uuid

from pydantic import BaseModel, ConfigDict, Field

from .models import FileContentStatus, FileKind


class FileProjectSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    context_revision: int = Field(ge=1)


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
    thumbnail: str | None
    projects: list[FileProjectSummary] = Field(default_factory=list)
    knowledge_base_count: int = Field(default=0, ge=0)
    in_checked_knowledge_base: bool = Field(
        default=False,
        description="Whether the file is in the knowledge base named by check_knowledge_base_id",
    )


class UserFileList(BaseModel):
    files: list[UserFile]
    total: int = Field(default=0, ge=0)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1)


class SimilarFile(BaseModel):
    file: UserFile
    score: float = Field(ge=-1, le=1, description="Cosine similarity between file embeddings")


class SimilarFileList(BaseModel):
    files: list[SimilarFile]
