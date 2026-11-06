"""Wire contracts for decks and cards.

Requests reject unknown fields. PATCH payloads treat omission as "unchanged" and
reject explicit null. Clients never send owner, project or derived fields.
"""

import datetime
import uuid
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, ValidationInfo, field_validator
from pydantic.json_schema import SkipJsonSchema

from .models import (
    MAX_CARD_SIDE_CHARS,
    MAX_DECK_DESCRIPTION_CHARS,
    MAX_DECK_NAME_CHARS,
    MAX_NOTE_BODY_CHARS,
    MAX_NOTE_TITLE_CHARS,
    MAX_QUIZ_TITLE_CHARS,
    MAX_RESPONSE_CHARS,
)

MAX_CARD_CITATIONS = 8
MAX_CHUNK_ID_CHARS = 200
MAX_EXCERPT_CHARS = 1_000

MAX_TAGS = 8
MAX_TAG_CHARS = 40


def normalize_tags(tags: list[str]) -> list[str]:
    """Trim and collapse whitespace; drop case-insensitive repeats, keeping the first spelling."""
    result: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        if "\n" in tag or "\r" in tag or "\x00" in tag:
            raise ValueError("Tags must be single lines")
        clean = " ".join(tag.split())
        if not clean:
            raise ValueError("Tags must not be blank")
        if len(clean) > MAX_TAG_CHARS:
            raise ValueError(f"Tags must be at most {MAX_TAG_CHARS} characters")
        if clean.casefold() not in seen:
            seen.add(clean.casefold())
            result.append(clean)
    return result


StudyTags = Annotated[list[str], Field(max_length=MAX_TAGS), AfterValidator(normalize_tags)]

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
    tags: StudyTags = Field(default_factory=list)


class StudyDeckUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # None means omitted; explicit null is rejected on the wire.
    name: DeckName | SkipJsonSchema[None] = None
    description: str | SkipJsonSchema[None] = Field(default=None, max_length=MAX_DECK_DESCRIPTION_CHARS)
    tags: StudyTags | SkipJsonSchema[None] = None

    @field_validator("name", "description", "tags", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        return _reject_null(value)


class StudyDeck(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: str
    tags: list[str]
    card_count: int = Field(ge=0)
    due_count: int = Field(ge=0)
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
    state: Literal["learning", "review", "relearning"]
    due_at: int
    reps: int = Field(ge=0)
    lapses: int = Field(ge=0)
    created_at: int
    updated_at: int


class StudyCardPage(BaseModel):
    items: list[StudyCard]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


# ---------------------------------------------------------------------------
# Card drafts (US-53.2, ADR-0034). Drafts are returned, never stored.
# ---------------------------------------------------------------------------

MAX_DRAFT_CARDS = 30
MAX_DRAFT_FILES = 10


class StudyCardDraftRequest(BaseModel):
    """Draft up to ``count`` cards from chosen files, or the whole project when ``file_ids`` is null."""

    model_config = ConfigDict(extra="forbid")

    model_id: uuid.UUID
    count: int = Field(ge=1, le=MAX_DRAFT_CARDS)
    file_ids: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=MAX_DRAFT_FILES)

    @field_validator("file_ids")
    @classmethod
    def unique_files(cls, value: list[uuid.UUID] | None) -> list[uuid.UUID] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("Each file can be chosen once")
        return value


class StudyCardDraft(BaseModel):
    front: str
    back: str
    citations: list[StudyCitation] = Field(min_length=1)


class StudyDraftFileResult(BaseModel):
    """What happened to one requested file. ``message`` explains a failure."""

    file_id: uuid.UUID
    file_name: str | None
    status: Literal["used", "failed"]
    message: str | None = None
    card_count: int = Field(ge=0)
    truncated: bool = False


class StudyCardDraftBatch(BaseModel):
    drafts: list[StudyCardDraft]
    files: list[StudyDraftFileResult]


# ---------------------------------------------------------------------------
# Review (US-53.3). Ratings follow FSRS: again, hard, good, easy.
# ---------------------------------------------------------------------------

StudyRating = Literal["again", "hard", "good", "easy"]
MAX_REVIEW_QUEUE = 200


class StudyReviewRequest(BaseModel):
    """Rate a card. ``expected_reps`` is the card's ``reps`` when shown, so a repeated
    submission (a double key press, a second tab) is rejected instead of counted twice."""

    model_config = ConfigDict(extra="forbid")

    rating: StudyRating
    expected_reps: int = Field(ge=0, le=2_147_483_647)


class StudyReviewPreview(BaseModel):
    """When the card would next be due (Unix seconds) for each rating."""

    again: int
    hard: int
    good: int
    easy: int


class StudyReviewCard(StudyCard):
    previews: StudyReviewPreview


class StudyReviewQueue(BaseModel):
    """Due cards in due order, capped at ``limit``; ``due_count`` counts all due cards."""

    items: list[StudyReviewCard]
    due_count: int = Field(ge=0)
    now: int


class StudyProjectSummary(BaseModel):
    deck_count: int = Field(ge=0)
    card_count: int = Field(ge=0)
    due_count: int = Field(ge=0)


# ---------------------------------------------------------------------------
# Practice quizzes (US-53.4, ADR-0035).
# ---------------------------------------------------------------------------

MAX_QUIZ_QUESTIONS = 20

QuizTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_QUIZ_TITLE_CHARS)]
StudyQuestionKind = Literal["multiple_choice", "short_answer"]
StudyVerdict = Literal["correct", "partial", "incorrect", "ungraded"]
StudyGrader = Literal["exact", "model", "none"]
StudyQuizOrigin = Literal["generated", "weak_spots", "topic"]


class StudyQuizGenerateRequest(BaseModel):
    """Generate a quiz of ``question_count`` questions of the chosen kinds.

    ``file_ids`` null means the whole project scope (at most 10 files). The quiz
    is saved when at least one question is produced.
    """

    model_config = ConfigDict(extra="forbid")

    model_id: uuid.UUID
    question_count: int = Field(ge=1, le=MAX_QUIZ_QUESTIONS)
    kinds: list[StudyQuestionKind] = Field(min_length=1, max_length=2)
    file_ids: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=MAX_DRAFT_FILES)
    title: QuizTitle | None = None
    tags: StudyTags = Field(default_factory=list)

    @field_validator("file_ids")
    @classmethod
    def unique_files(cls, value: list[uuid.UUID] | None) -> list[uuid.UUID] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("Each file can be chosen once")
        return value

    @field_validator("kinds")
    @classmethod
    def unique_kinds(cls, value: list[StudyQuestionKind]) -> list[StudyQuestionKind]:
        if len(set(value)) != len(value):
            raise ValueError("Each question kind can be chosen once")
        return value


class StudyQuizUpdate(BaseModel):
    """Rename and retag; omitted fields are unchanged."""

    model_config = ConfigDict(extra="forbid")

    title: QuizTitle | SkipJsonSchema[None] = None
    tags: StudyTags | SkipJsonSchema[None] = None

    @field_validator("title", "tags", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        return _reject_null(value)


class StudyQuizSummary(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    title: str
    tags: list[str]
    question_count: int = Field(ge=0)
    multiple_choice_count: int = Field(ge=0)
    short_answer_count: int = Field(ge=0)
    attempt_count: int = Field(ge=0)
    # Score fraction (0–1) of the newest and the best attempt, null before the first.
    last_score: float | None
    best_score: float | None
    # generated from files by ``model_name``, or weak_spots (copied from missed items; no model).
    origin: StudyQuizOrigin
    model_id: uuid.UUID | None
    model_name: str | None
    created_at: int
    updated_at: int


class StudyQuizPage(BaseModel):
    items: list[StudyQuizSummary]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class StudyQuizQuestion(BaseModel):
    """A question as shown while taking the quiz: no answer key and no sources."""

    id: uuid.UUID
    position: int = Field(ge=0)
    kind: StudyQuestionKind
    prompt: str
    options: list[str]


class StudyQuiz(StudyQuizSummary):
    questions: list[StudyQuizQuestion]


class StudyQuizFileResult(BaseModel):
    """What happened to one requested file. ``message`` explains a failure."""

    file_id: uuid.UUID
    file_name: str | None
    status: Literal["used", "failed"]
    message: str | None = None
    question_count: int = Field(ge=0)
    truncated: bool = False


class StudyQuizGeneration(BaseModel):
    """The saved quiz, or null when no file produced a usable question."""

    quiz: StudyQuiz | None
    files: list[StudyQuizFileResult]


class StudyQuizAnswerInput(BaseModel):
    """``choice`` (an option index) answers multiple choice; ``text`` answers short answer."""

    model_config = ConfigDict(extra="forbid")

    question_id: uuid.UUID
    choice: int | None = Field(default=None, ge=0, le=100)
    text: str | None = Field(default=None, max_length=MAX_RESPONSE_CHARS)


class StudyQuizAttemptRequest(BaseModel):
    """Submit answers. Omitted questions count as unanswered.

    ``model_id`` grades short answers and is required when any short answer is
    not blank.
    """

    model_config = ConfigDict(extra="forbid")

    answers: list[StudyQuizAnswerInput] = Field(max_length=MAX_QUIZ_QUESTIONS)
    model_id: uuid.UUID | None = None

    @field_validator("answers")
    @classmethod
    def unique_questions(cls, value: list[StudyQuizAnswerInput]) -> list[StudyQuizAnswerInput]:
        if len({answer.question_id for answer in value}) != len(value):
            raise ValueError("Answer each question once")
        return value


class StudyQuizAttemptSummary(BaseModel):
    id: uuid.UUID
    quiz_id: uuid.UUID
    submitted_at: int
    # Points: 1 per correct answer, 0.5 per partial short answer.
    score: float = Field(ge=0)
    question_count: int = Field(ge=1)
    ungraded_count: int = Field(ge=0)
    grader_model_id: uuid.UUID | None
    grader_model_name: str | None


class StudyQuizAttemptPage(BaseModel):
    items: list[StudyQuizAttemptSummary]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class StudyQuizResult(BaseModel):
    """One graded question with its answer key and sources. Text fields are untrusted."""

    question_id: uuid.UUID
    position: int = Field(ge=0)
    kind: StudyQuestionKind
    prompt: str
    options: list[str]
    correct_option: int | None
    rubric: str
    explanation: str
    citations: list[StudyCitation]
    choice: int | None
    text: str | None
    verdict: StudyVerdict
    grader: StudyGrader
    feedback: str


class StudyQuizAttempt(StudyQuizAttemptSummary):
    quiz_title: str
    results: list[StudyQuizResult]


# ---------------------------------------------------------------------------
# Weak spots (US-53.5, ADR-0036). Derived on read; never stored.
# ---------------------------------------------------------------------------

MAX_WEAK_SPOTS = 50
MAX_PRACTICE_QUESTIONS = 20


class StudyWeakSpot(BaseModel):
    """A question or card whose latest outcome was a miss. Text is untrusted.

    ``root_*`` names the original item (a copy re-asked in a weak-spot quiz counts
    towards its original); ``source_*`` is the question or card last answered.
    ``container_*`` is that source's quiz or deck.
    """

    root_kind: Literal["question", "card"]
    root_id: uuid.UUID
    source_kind: Literal["question", "card"]
    source_id: uuid.UUID
    kind: Literal["multiple_choice", "short_answer", "card"]
    prompt: str
    outcome: Literal["incorrect", "partial", "again"]
    missed_at: int
    container_id: uuid.UUID
    container_title: str
    citations: list[StudyCitation]


class StudyWeakSpots(BaseModel):
    """The most recent weak spots, capped at ``limit``; ``total`` counts all of them."""

    items: list[StudyWeakSpot]
    total: int = Field(ge=0)


class StudyWeakSpotPracticeRequest(BaseModel):
    """Build a quiz from up to ``question_count`` of the most recent weak spots."""

    model_config = ConfigDict(extra="forbid")

    question_count: int = Field(default=10, ge=1, le=MAX_PRACTICE_QUESTIONS)


# ---------------------------------------------------------------------------
# Notes, summaries and study guides (US-53.6, ADR-0037).
# Summaries and guides are drafts; only an explicit save creates a note.
# ---------------------------------------------------------------------------

MAX_NOTE_CITATIONS = 50
MAX_GUIDE_DAYS = 60

NoteTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NOTE_TITLE_CHARS)]
NoteBody = Annotated[str, StringConstraints(min_length=1, max_length=MAX_NOTE_BODY_CHARS, pattern=r"\S")]
StudyNoteKind = Literal["summary", "study_guide"]
StudySummaryDepth = Literal["simple", "standard", "expert"]


class StudyNoteCreate(BaseModel):
    """Save a draft as a note. ``model_id`` records which model wrote it."""

    model_config = ConfigDict(extra="forbid")

    kind: StudyNoteKind
    title: NoteTitle
    body: NoteBody
    citations: list[StudyCitationInput] = Field(default_factory=list, max_length=MAX_NOTE_CITATIONS)
    model_id: uuid.UUID | None = None


class StudyNoteUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: NoteTitle | SkipJsonSchema[None] = None
    body: NoteBody | SkipJsonSchema[None] = None

    @field_validator("title", "body", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        return _reject_null(value)


class StudyNoteSummary(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    kind: StudyNoteKind
    title: str
    model_name: str | None
    created_at: int
    updated_at: int


class StudyNote(StudyNoteSummary):
    """A note. ``body`` is untrusted Markdown; citations are checked against live scope."""

    body: str
    citations: list[StudyCitation]
    model_id: uuid.UUID | None


class StudyNotePage(BaseModel):
    items: list[StudyNoteSummary]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class StudySourceFileResult(BaseModel):
    """What happened to one requested file. ``message`` explains a failure."""

    file_id: uuid.UUID
    file_name: str | None
    status: Literal["used", "failed"]
    message: str | None = None
    section_count: int = Field(ge=0)
    truncated: bool = False


class StudySummaryRequest(BaseModel):
    """Summarize chosen files, or the whole project scope when ``file_ids`` is null."""

    model_config = ConfigDict(extra="forbid")

    model_id: uuid.UUID
    depth: StudySummaryDepth
    file_ids: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=MAX_DRAFT_FILES)

    @field_validator("file_ids")
    @classmethod
    def unique_files(cls, value: list[uuid.UUID] | None) -> list[uuid.UUID] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("Each file can be chosen once")
        return value


class StudySummarySection(BaseModel):
    file_id: uuid.UUID
    file_name: str | None
    heading: str
    text: str
    citations: list[StudyCitation] = Field(min_length=1)


class StudySummaryDraft(BaseModel):
    """An unsaved summary. ``body`` and ``citations`` are what a save stores."""

    title: str
    depth: StudySummaryDepth
    sections: list[StudySummarySection]
    body: str
    citations: list[StudyCitation]
    files: list[StudySourceFileResult]
    model_id: uuid.UUID
    model_name: str


class StudyGuideRequest(BaseModel):
    """Plan study days from ``start_date`` through ``exam_date`` (inclusive, at most 60 days)."""

    model_config = ConfigDict(extra="forbid")

    model_id: uuid.UUID
    start_date: datetime.date
    exam_date: datetime.date
    minutes_per_day: int = Field(default=60, ge=10, le=480)

    @field_validator("exam_date")
    @classmethod
    def within_range(cls, value: datetime.date, info: ValidationInfo) -> datetime.date:
        start = info.data.get("start_date")
        if start is not None:
            if value < start:
                raise ValueError("The exam date must be on or after the start date")
            if (value - start).days + 1 > MAX_GUIDE_DAYS:
                raise ValueError(f"Plan at most {MAX_GUIDE_DAYS} days")
        return value


class StudyGuideLink(BaseModel):
    """A deck or quiz in this project that a task points to."""

    kind: Literal["deck", "quiz"]
    id: uuid.UUID
    title: str


class StudyGuideTask(BaseModel):
    text: str
    minutes: int | None = Field(default=None, ge=1, le=480)
    link: StudyGuideLink | None = None


class StudyGuideDay(BaseModel):
    date: datetime.date
    focus: str
    tasks: list[StudyGuideTask]


class StudyGuideDraft(BaseModel):
    """An unsaved day-by-day plan. Days the model left out are rest days. ``body`` is what a save stores."""

    title: str
    start_date: datetime.date
    exam_date: datetime.date
    minutes_per_day: int
    days: list[StudyGuideDay]
    body: str
    model_id: uuid.UUID
    model_name: str


# --- Topic mastery (US-58.3) -------------------------------------------------

MasteryLevel = Literal["not_started", "needs_work", "developing", "mastered"]


class StudyTrendPoint(BaseModel):
    """Mastery as of ``at`` (end of a week); null when nothing had been practiced."""

    at: int
    score: float | None


class StudyTopicMastery(BaseModel):
    # Case-folded tag that identifies the topic; ``label`` is its first spelling.
    key: str
    label: str
    level: MasteryLevel
    # Mean of each practiced item's latest score (0–1); null when none was practiced.
    score: float | None
    practiced: int = Field(ge=0)
    total: int = Field(ge=0)
    deck_count: int = Field(ge=0)
    quiz_count: int = Field(ge=0)
    # Weekly points, oldest first, ending now.
    trend: list[StudyTrendPoint]


class StudyTopicMasteryList(BaseModel):
    items: list[StudyTopicMastery]
    computed_at: int


class StudyTopicPracticeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    topic: str = Field(min_length=1, max_length=MAX_TAG_CHARS)
    question_count: int = Field(default=10, ge=1, le=MAX_QUIZ_QUESTIONS)
