"""Wire contracts for decks and cards.

Requests reject unknown fields. PATCH payloads treat omission as "unchanged" and
reject explicit null. Clients never send owner, project or derived fields.
"""

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic.json_schema import SkipJsonSchema

from .models import MAX_CARD_SIDE_CHARS, MAX_DECK_DESCRIPTION_CHARS, MAX_DECK_NAME_CHARS

MAX_CARD_CITATIONS = 8
MAX_CHUNK_ID_CHARS = 200
MAX_EXCERPT_CHARS = 1_000

DeckName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_DECK_NAME_CHARS)]
CardSide = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_CARD_SIDE_CHARS)]


def _reject_null(value: object) -> object:
    if value is None:
        raise ValueError("Fields cannot be null; omit them to keep the current value")
    return value


class StudyCitationInput(BaseModel):
    """A reference to a project file, optionally narrowed to one retrieval chunk."""

    model_config = ConfigDict(extra="forbid")

    file_id: uuid.UUID
    chunk_id: str | None = Field(default=None, min_length=1, max_length=MAX_CHUNK_ID_CHARS)
    artifact_generation: int | None = Field(default=None, ge=0, le=2_147_483_647)
    excerpt: str | None = Field(default=None, max_length=MAX_EXCERPT_CHARS)


class StudyCitation(StudyCitationInput):
    """A stored citation plus its live state.

    ``available`` is false when the file has left the project or was deleted;
    ``file_name`` is then null.
    """

    model_config = ConfigDict(extra="ignore")

    available: bool
    file_name: str | None


class StudyDeckCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: DeckName
    description: str = Field(default="", max_length=MAX_DECK_DESCRIPTION_CHARS)


class StudyDeckUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # None means omitted; explicit null is rejected on the wire.
    name: DeckName | SkipJsonSchema[None] = None
    description: str | SkipJsonSchema[None] = Field(default=None, max_length=MAX_DECK_DESCRIPTION_CHARS)

    @field_validator("name", "description", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        return _reject_null(value)


class StudyDeck(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: str
    card_count: int = Field(ge=0)
    created_at: int
    updated_at: int


class StudyDeckPage(BaseModel):
    items: list[StudyDeck]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class StudyCardCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    front: CardSide
    back: CardSide
    citations: list[StudyCitationInput] = Field(default_factory=list, max_length=MAX_CARD_CITATIONS)


class StudyCardUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    front: CardSide | SkipJsonSchema[None] = None
    back: CardSide | SkipJsonSchema[None] = None
    # An empty list clears the citations.
    citations: list[StudyCitationInput] | SkipJsonSchema[None] = Field(default=None, max_length=MAX_CARD_CITATIONS)

    @field_validator("front", "back", "citations", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        return _reject_null(value)


class StudyCard(BaseModel):
    id: uuid.UUID
    deck_id: uuid.UUID
    front: str
    back: str
    citations: list[StudyCitation]
    created_at: int
    updated_at: int


class StudyCardPage(BaseModel):
    items: list[StudyCard]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
