"""API contracts; clients write the whole document, never owner or derived metadata."""

import uuid
from enum import StrEnum

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


# ---------------------------------------------------------------------------
# Prompt coach (US-51.6). Reviews are ephemeral: nothing here is persisted.
# ---------------------------------------------------------------------------

MAX_COACH_PROMPT_CHARS = 16_000
MAX_COACH_SUGGESTIONS = 6
MAX_COACH_MESSAGE_CHARS = 300
MAX_COACH_EDIT_CHARS = 2_000


class CoachCriterion(StrEnum):
    """The rubric a draft is reviewed against, in display order."""

    GOAL = "goal"
    AUDIENCE = "audience"
    CONTEXT = "context"
    CONSTRAINTS = "constraints"
    OUTPUT_FORMAT = "output_format"
    EXAMPLES = "examples"


class PromptCoachStatus(BaseModel):
    """Whether the caller can use the coach right now.

    ``enabled`` is the caller's own opt-in setting; ``available`` is whether a
    model can run reviews (the draft model, else the caller's own plan).
    """

    enabled: bool
    available: bool


class PromptReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=1, max_length=MAX_COACH_PROMPT_CHARS)
    # The composer's selected chat model; only used to pick among the owner's plan models.
    model_id: uuid.UUID | None = None


class PromptSuggestion(BaseModel):
    """One checklist item and the edit that applies it.

    With ``find`` set, applying replaces that exact text of the reviewed draft
    with ``text``; otherwise ``text`` is appended as a new paragraph.
    """

    id: str
    criterion: CoachCriterion
    message: str = Field(max_length=MAX_COACH_MESSAGE_CHARS)
    find: str | None = Field(default=None, max_length=MAX_COACH_PROMPT_CHARS)
    text: str = Field(max_length=MAX_COACH_EDIT_CHARS)


class PromptReview(BaseModel):
    suggestions: list[PromptSuggestion] = Field(max_length=MAX_COACH_SUGGESTIONS)
