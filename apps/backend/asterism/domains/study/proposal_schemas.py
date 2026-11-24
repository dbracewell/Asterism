"""Draft decks and quizzes from chat (EPIC-98, ADR-0080).

A draft is model output: the tool's arguments are validated here like any
input, with the same limits as the button flows, before they are stored. Drafts
cite project files by id; saving checks each file is still in the project.
"""

import uuid
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from .models import (
    MAX_DECK_DESCRIPTION_CHARS,
    MAX_EXPLANATION_CHARS,
    MAX_OPTION_CHARS,
    MAX_OPTIONS,
    MAX_QUESTION_PROMPT_CHARS,
    MAX_RUBRIC_CHARS,
    MIN_OPTIONS,
)
from .schemas import MAX_CARD_CITATIONS, MAX_DRAFT_CARDS, MAX_QUIZ_QUESTIONS, CardSide, DeckName, QuizTitle

StudyProposalKind = Literal["deck", "quiz"]
StudyProposalStatus = Literal["pending", "saved", "dismissed"]

Prompt = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_QUESTION_PROMPT_CHARS)]
Option = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_OPTION_CHARS)]
Cited = Annotated[list[uuid.UUID], Field(default_factory=list, max_length=MAX_CARD_CITATIONS)]


class StudyCardDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    front: CardSide
    back: CardSide
    file_ids: Cited

    @field_validator("file_ids")
    @classmethod
    def _dedupe(cls, value: list[uuid.UUID]) -> list[uuid.UUID]:
        return list(dict.fromkeys(value))


class StudyDeckDraft(BaseModel):
    """A new deck with its cards."""

    model_config = ConfigDict(extra="forbid")

    title: DeckName
    description: str = Field(default="", max_length=MAX_DECK_DESCRIPTION_CHARS)
    cards: list[StudyCardDraft] = Field(min_length=1, max_length=MAX_DRAFT_CARDS)


class StudyQuestionDraft(BaseModel):
    """Multiple choice (options and the correct one) or short answer (a rubric)."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["multiple_choice", "short_answer"]
    prompt: Prompt
    options: list[Option] = Field(default_factory=list, max_length=MAX_OPTIONS)
    correct_option: int | None = Field(default=None, ge=0)
    rubric: str = Field(default="", max_length=MAX_RUBRIC_CHARS)
    explanation: str = Field(default="", max_length=MAX_EXPLANATION_CHARS)
    file_ids: Cited

    @field_validator("file_ids")
    @classmethod
    def _dedupe(cls, value: list[uuid.UUID]) -> list[uuid.UUID]:
        return list(dict.fromkeys(value))

    @model_validator(mode="after")
    def _answer_key(self) -> Self:
        if self.kind == "multiple_choice":
            if not MIN_OPTIONS <= len(self.options) <= MAX_OPTIONS:
                raise ValueError(f"A multiple choice question needs {MIN_OPTIONS} to {MAX_OPTIONS} options")
            if len(set(self.options)) != len(self.options):
                raise ValueError("Each option must be different")
            if self.correct_option is None or self.correct_option >= len(self.options):
                raise ValueError("Name the correct option by its index")
            if self.rubric.strip():
                raise ValueError("A multiple choice question has no rubric")
        else:
            if self.options or self.correct_option is not None:
                raise ValueError("A short answer question has no options")
            if not self.rubric.strip():
                raise ValueError("A short answer question needs a rubric")
        return self


class StudyQuizDraft(BaseModel):
    """A new quiz with its questions."""

    model_config = ConfigDict(extra="forbid")

    title: QuizTitle
    questions: list[StudyQuestionDraft] = Field(min_length=1, max_length=MAX_QUIZ_QUESTIONS)


class StudyProposal(BaseModel):
    """A draft as the chat shows it."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    chat_id: uuid.UUID
    message_id: uuid.UUID
    kind: StudyProposalKind
    status: StudyProposalStatus
    deck: StudyDeckDraft | None = None
    quiz: StudyQuizDraft | None = None
    saved_id: uuid.UUID | None = None
    created_at: int
    decided_at: int | None = None
