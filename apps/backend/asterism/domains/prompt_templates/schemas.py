"""API contracts; clients write the whole document, never owner or derived metadata."""

import uuid

from pydantic import BaseModel, ConfigDict, Field

from .documents import TemplateDocument

# Revision inputs must fit a portable SQL integer, not an arbitrary JSON integer.
MAX_REVISION = 2_147_483_647


class PromptTemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document: TemplateDocument


class PromptTemplateUpdate(PromptTemplateCreate):
    expected_revision: int = Field(ge=1, le=MAX_REVISION)


class PromptTemplateSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    description: str
    revision: int
    created_at: int
    updated_at: int


class PromptTemplate(PromptTemplateSummary):
    document: TemplateDocument


class PromptTemplatePage(BaseModel):
    items: list[PromptTemplateSummary]
    total: int
    page: int
    page_size: int


class PromptFramework(BaseModel):
    id: str
    revision: int
    name: str
    description: str
    document: TemplateDocument


class PromptFrameworkCatalog(BaseModel):
    version: int
    items: list[PromptFramework]
