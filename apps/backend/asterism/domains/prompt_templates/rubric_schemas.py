"""Rubric API contracts (US-57.1); clients write the whole document."""

import uuid

from pydantic import BaseModel, ConfigDict, Field

from .rubrics import RubricDocument
from .schemas import MAX_REVISION


class RubricCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document: RubricDocument


class RubricUpdate(RubricCreate):
    expected_revision: int = Field(ge=1, le=MAX_REVISION)


class RubricSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    description: str
    revision: int
    created_at: int
    updated_at: int


class Rubric(RubricSummary):
    document: RubricDocument


class RubricPage(BaseModel):
    items: list[RubricSummary]
    total: int
    page: int
    page_size: int


class BundledRubricView(BaseModel):
    id: str
    revision: int
    name: str
    description: str
    document: RubricDocument


class RubricCatalog(BaseModel):
    version: int
    items: list[BundledRubricView]
