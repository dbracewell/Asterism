"""User-owned study decks and cards, scoped to a project (ADR-0033).

Every row carries a denormalized ``user_id`` so composite foreign keys pin a
deck to its owner's project and a card to its owner's deck. Deleting a project
(or a user, through projects) cascades to its decks and their cards.
"""

import uuid

from sqlalchemy import CheckConstraint, Float, ForeignKeyConstraint, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin, get_unix_timestamp

MAX_DECK_NAME_CHARS = 120
MAX_DECK_DESCRIPTION_CHARS = 2_000
MAX_CARD_SIDE_CHARS = 4_000


class StudyDeckModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "study_decks"

    user_id: Mapped[str] = mapped_column(String, nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    name: Mapped[str] = mapped_column(String(MAX_DECK_NAME_CHARS), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            ondelete="CASCADE",
            name="fk_study_decks_project_owner",
        ),
        # Lets cards reference (id, user_id) as a composite foreign key.
        UniqueConstraint("id", "user_id", name="uq_study_decks_id_user"),
        CheckConstraint(
            f"length(trim(name)) > 0 AND length(name) <= {MAX_DECK_NAME_CHARS}", name="ck_study_decks_name"
        ),
        CheckConstraint(f"length(description) <= {MAX_DECK_DESCRIPTION_CHARS}", name="ck_study_decks_description"),
        Index("idx_study_decks_project", "user_id", "project_id", "updated_at", "id"),
    )


class StudyCardModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "study_cards"

    user_id: Mapped[str] = mapped_column(String, nullable=False)
    deck_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    front: Mapped[str] = mapped_column(Text, nullable=False)
    back: Mapped[str] = mapped_column(Text, nullable=False)
    # Canonical JSON list of StudyCitationInput; validated by the service, never a foreign key.
    citations: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    # Scheduler state (ADR-0033). A new card is learning at step 0 and due at creation.
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="learning", server_default="learning")
    step: Mapped[int | None] = mapped_column(Integer, nullable=True, default=0)
    stability: Mapped[float | None] = mapped_column(Float, nullable=True)
    difficulty: Mapped[float | None] = mapped_column(Float, nullable=True)
    due_at: Mapped[int] = mapped_column(Integer, nullable=False, default=get_unix_timestamp)
    last_reviewed_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reps: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    lapses: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    __table_args__ = (
        # Lets review logs reference (id, user_id) as a composite foreign key.
        UniqueConstraint("id", "user_id", name="uq_study_cards_id_user"),
        CheckConstraint("state IN ('learning', 'review', 'relearning')", name="ck_study_cards_state"),
        CheckConstraint("reps >= 0 AND lapses >= 0", name="ck_study_cards_counts"),
        CheckConstraint("difficulty IS NULL OR difficulty BETWEEN 1 AND 10", name="ck_study_cards_difficulty"),
        CheckConstraint("stability IS NULL OR stability > 0", name="ck_study_cards_stability"),
        ForeignKeyConstraint(
            ["deck_id", "user_id"],
            ["study_decks.id", "study_decks.user_id"],
            ondelete="CASCADE",
            name="fk_study_cards_deck_owner",
        ),
        CheckConstraint(
            f"length(trim(front)) > 0 AND length(front) <= {MAX_CARD_SIDE_CHARS}", name="ck_study_cards_front"
        ),
        CheckConstraint(
            f"length(trim(back)) > 0 AND length(back) <= {MAX_CARD_SIDE_CHARS}", name="ck_study_cards_back"
        ),
        Index("idx_study_cards_deck", "user_id", "deck_id", "created_at", "id"),
        Index("idx_study_cards_due", "user_id", "deck_id", "due_at", "id"),
    )


class StudyReviewLogModel(Base, UuidPrimaryKeyMixin):
    """One rating of one card: an append-only, user-owned record, not agent memory."""

    __tablename__ = "study_review_logs"

    user_id: Mapped[str] = mapped_column(String, nullable=False)
    card_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    reviewed_at: Mapped[int] = mapped_column(Integer, nullable=False)
    previous_state: Mapped[str] = mapped_column(String(16), nullable=False)
    previous_due_at: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    due_at: Mapped[int] = mapped_column(Integer, nullable=False)
    stability: Mapped[float] = mapped_column(Float, nullable=False)
    difficulty: Mapped[float] = mapped_column(Float, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["card_id", "user_id"],
            ["study_cards.id", "study_cards.user_id"],
            ondelete="CASCADE",
            name="fk_study_review_logs_card_owner",
        ),
        CheckConstraint("rating BETWEEN 1 AND 4", name="ck_study_review_logs_rating"),
        Index("idx_study_review_logs_card", "user_id", "card_id", "reviewed_at"),
    )


# --- Practice quizzes (US-53.4, ADR-0035) ------------------------------------

MAX_QUIZ_TITLE_CHARS = 120
MAX_QUESTION_PROMPT_CHARS = 2_000
MAX_OPTION_CHARS = 500
MIN_OPTIONS = 2
MAX_OPTIONS = 6
MAX_RUBRIC_CHARS = 2_000
MAX_EXPLANATION_CHARS = 2_000
MAX_RESPONSE_CHARS = 2_000
MAX_FEEDBACK_CHARS = 2_000


class StudyQuizModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """A generated quiz. Its questions are fixed once generated; only the title changes."""

    __tablename__ = "study_quizzes"

    user_id: Mapped[str] = mapped_column(String, nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String(MAX_QUIZ_TITLE_CHARS), nullable=False)
    # Provenance of the generating model; not a foreign key, so model deletion keeps the quiz.
    model_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    model_name: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            ondelete="CASCADE",
            name="fk_study_quizzes_project_owner",
        ),
        UniqueConstraint("id", "user_id", name="uq_study_quizzes_id_user"),
        CheckConstraint(
            f"length(trim(title)) > 0 AND length(title) <= {MAX_QUIZ_TITLE_CHARS}", name="ck_study_quizzes_title"
        ),
        Index("idx_study_quizzes_project", "user_id", "project_id", "created_at", "id"),
    )


class StudyQuizQuestionModel(Base, UuidPrimaryKeyMixin):
    """One question. Multiple choice stores options and the correct index; short answer stores a rubric."""

    __tablename__ = "study_quiz_questions"

    user_id: Mapped[str] = mapped_column(String, nullable=False)
    quiz_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    # Canonical JSON list of option strings; "[]" for short answer.
    options: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")
    correct_option: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rubric: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    explanation: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    # Canonical JSON list of StudyCitationInput, as on cards.
    citations: Mapped[str] = mapped_column(Text, nullable=False, default="[]", server_default="[]")

    __table_args__ = (
        ForeignKeyConstraint(
            ["quiz_id", "user_id"],
            ["study_quizzes.id", "study_quizzes.user_id"],
            ondelete="CASCADE",
            name="fk_study_quiz_questions_quiz_owner",
        ),
        UniqueConstraint("id", "user_id", name="uq_study_quiz_questions_id_user"),
        UniqueConstraint("quiz_id", "position", name="uq_study_quiz_questions_position"),
        CheckConstraint("kind IN ('multiple_choice', 'short_answer')", name="ck_study_quiz_questions_kind"),
        CheckConstraint(
            "(kind = 'multiple_choice' AND correct_option IS NOT NULL AND correct_option >= 0) OR "
            "(kind = 'short_answer' AND correct_option IS NULL AND length(trim(rubric)) > 0)",
            name="ck_study_quiz_questions_answer_key",
        ),
        CheckConstraint(
            f"length(trim(prompt)) > 0 AND length(prompt) <= {MAX_QUESTION_PROMPT_CHARS}",
            name="ck_study_quiz_questions_prompt",
        ),
        CheckConstraint(
            f"length(rubric) <= {MAX_RUBRIC_CHARS} AND length(explanation) <= {MAX_EXPLANATION_CHARS}",
            name="ck_study_quiz_questions_key_lengths",
        ),
        Index("idx_study_quiz_questions_quiz", "user_id", "quiz_id", "position"),
    )


class StudyQuizAttemptModel(Base, UuidPrimaryKeyMixin):
    """One submitted, graded attempt: an append-only, user-owned record, not agent memory."""

    __tablename__ = "study_quiz_attempts"

    user_id: Mapped[str] = mapped_column(String, nullable=False)
    quiz_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    submitted_at: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    question_count: Mapped[int] = mapped_column(Integer, nullable=False)
    ungraded_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # The short-answer grading model, when one was used; provenance only.
    grader_model_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    grader_model_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["quiz_id", "user_id"],
            ["study_quizzes.id", "study_quizzes.user_id"],
            ondelete="CASCADE",
            name="fk_study_quiz_attempts_quiz_owner",
        ),
        UniqueConstraint("id", "user_id", name="uq_study_quiz_attempts_id_user"),
        CheckConstraint(
            "question_count > 0 AND ungraded_count BETWEEN 0 AND question_count "
            "AND score >= 0 AND score <= question_count",
            name="ck_study_quiz_attempts_counts",
        ),
        Index("idx_study_quiz_attempts_quiz", "user_id", "quiz_id", "submitted_at", "id"),
    )


class StudyQuizAnswerModel(Base, UuidPrimaryKeyMixin):
    """The learner's response to one question in one attempt, with its grade."""

    __tablename__ = "study_quiz_answers"

    user_id: Mapped[str] = mapped_column(String, nullable=False)
    attempt_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    question_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    choice: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # correct, partial, incorrect, or ungraded when model grading failed.
    verdict: Mapped[str] = mapped_column(String(16), nullable=False)
    # exact (multiple choice), model (short answer), or none (blank answer).
    grader: Mapped[str] = mapped_column(String(16), nullable=False)
    feedback: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")

    __table_args__ = (
        ForeignKeyConstraint(
            ["attempt_id", "user_id"],
            ["study_quiz_attempts.id", "study_quiz_attempts.user_id"],
            ondelete="CASCADE",
            name="fk_study_quiz_answers_attempt_owner",
        ),
        ForeignKeyConstraint(
            ["question_id", "user_id"],
            ["study_quiz_questions.id", "study_quiz_questions.user_id"],
            ondelete="CASCADE",
            name="fk_study_quiz_answers_question_owner",
        ),
        UniqueConstraint("attempt_id", "question_id", name="uq_study_quiz_answers_question"),
        CheckConstraint(
            "verdict IN ('correct', 'partial', 'incorrect', 'ungraded')", name="ck_study_quiz_answers_verdict"
        ),
        CheckConstraint("grader IN ('exact', 'model', 'none')", name="ck_study_quiz_answers_grader"),
        CheckConstraint(
            f"(text IS NULL OR length(text) <= {MAX_RESPONSE_CHARS}) AND length(feedback) <= {MAX_FEEDBACK_CHARS}",
            name="ck_study_quiz_answers_lengths",
        ),
        Index("idx_study_quiz_answers_attempt", "user_id", "attempt_id"),
    )
