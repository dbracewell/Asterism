import uuid

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeBaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)


class KnowledgeBaseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=10_000)


class KnowledgeBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    created_at: int
    updated_at: int


class KnowledgeBaseList(BaseModel):
    knowledge_bases: list[KnowledgeBase]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class KnowledgeDocumentCreate(BaseModel):
    file_id: uuid.UUID
    metadata: dict[str, str] = Field(default_factory=dict, max_length=32)


class KnowledgeDocumentUpdate(BaseModel):
    metadata: dict[str, str] = Field(max_length=32)


class KnowledgeDocumentRevisionCreate(BaseModel):
    file_id: uuid.UUID
    metadata: dict[str, str] | None = Field(default=None, max_length=32)


class KnowledgeDocument(BaseModel):
    id: uuid.UUID
    knowledge_base_id: uuid.UUID
    file_id: uuid.UUID | None
    original_name: str
    mime_type: str
    content_sha256: str
    revision: int = Field(ge=1)
    position: int = Field(ge=0)
    status: str
    error: str | None
    indexed_at: int | None
    replaces_document_id: uuid.UUID | None
    metadata: dict[str, str]
    created_at: int
    updated_at: int


class KnowledgeDocumentList(BaseModel):
    documents: list[KnowledgeDocument]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class KnowledgeBaseAssignmentReplace(BaseModel):
    knowledge_base_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)


class KnowledgeBaseAssignmentList(BaseModel):
    knowledge_base_ids: list[uuid.UUID]
