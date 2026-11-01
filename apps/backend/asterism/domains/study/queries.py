"""Owner-scoped base selects for study records. Callers filter before pagination."""

import uuid

from sqlalchemy import case, func, select

from .models import (
    StudyCardModel,
    StudyDeckModel,
    StudyQuizAnswerModel,
    StudyQuizAttemptModel,
    StudyQuizModel,
    StudyQuizQuestionModel,
)


def select_owned_decks(*, user_id: str, project_id: uuid.UUID):
    """Decks of one project owned by the caller; unordered so callers can add filters."""
    return select(StudyDeckModel).where(StudyDeckModel.user_id == user_id, StudyDeckModel.project_id == project_id)


def select_owned_cards(*, user_id: str, deck_id: uuid.UUID):
    """Cards of one deck owned by the caller; unordered so callers can add filters."""
    return select(StudyCardModel).where(StudyCardModel.user_id == user_id, StudyCardModel.deck_id == deck_id)


def count_cards_by_deck(*, user_id: str, deck_ids: list[uuid.UUID]):
    """``(deck_id, count)`` rows for the requested owned decks; empty decks are absent."""
    return (
        select(StudyCardModel.deck_id, func.count(StudyCardModel.id))
        .where(StudyCardModel.user_id == user_id, StudyCardModel.deck_id.in_(deck_ids))
        .group_by(StudyCardModel.deck_id)
    )


def count_due_by_deck(*, user_id: str, deck_ids: list[uuid.UUID], now: int):
    """``(deck_id, due count)`` rows for the requested owned decks; decks with none are absent."""
    return (
        select(StudyCardModel.deck_id, func.count(StudyCardModel.id))
        .where(
            StudyCardModel.user_id == user_id,
            StudyCardModel.deck_id.in_(deck_ids),
            StudyCardModel.due_at <= now,
        )
        .group_by(StudyCardModel.deck_id)
    )


def select_due_cards(*, user_id: str, deck_id: uuid.UUID, now: int):
    """Due cards of one owned deck, most overdue first, ties by id."""
    return (
        select_owned_cards(user_id=user_id, deck_id=deck_id)
        .where(StudyCardModel.due_at <= now)
        .order_by(StudyCardModel.due_at, StudyCardModel.id)
    )


def project_card_totals(*, user_id: str, project_id: uuid.UUID, now: int):
    """One ``(card count, due count)`` row over every deck of one owned project."""
    decks = select(StudyDeckModel.id).where(StudyDeckModel.user_id == user_id, StudyDeckModel.project_id == project_id)
    return select(
        func.count(StudyCardModel.id),
        func.coalesce(func.sum(case((StudyCardModel.due_at <= now, 1), else_=0)), 0),
    ).where(StudyCardModel.user_id == user_id, StudyCardModel.deck_id.in_(decks))


# --- Practice quizzes -------------------------------------------------------


def select_owned_quizzes(*, user_id: str, project_id: uuid.UUID):
    """Quizzes of one project owned by the caller; unordered so callers can add filters."""
    return select(StudyQuizModel).where(StudyQuizModel.user_id == user_id, StudyQuizModel.project_id == project_id)


def select_quiz_questions(*, user_id: str, quiz_id: uuid.UUID):
    """Questions of one owned quiz in quiz order."""
    return (
        select(StudyQuizQuestionModel)
        .where(StudyQuizQuestionModel.user_id == user_id, StudyQuizQuestionModel.quiz_id == quiz_id)
        .order_by(StudyQuizQuestionModel.position)
    )


def select_quiz_attempts(*, user_id: str, quiz_id: uuid.UUID):
    """Attempts of one owned quiz; unordered so callers can add filters."""
    return select(StudyQuizAttemptModel).where(
        StudyQuizAttemptModel.user_id == user_id, StudyQuizAttemptModel.quiz_id == quiz_id
    )


def select_attempt_answers(*, user_id: str, attempt_id: uuid.UUID):
    """Answers of one owned attempt; unordered (callers align them with questions)."""
    return select(StudyQuizAnswerModel).where(
        StudyQuizAnswerModel.user_id == user_id, StudyQuizAnswerModel.attempt_id == attempt_id
    )


def count_questions_by_quiz(*, user_id: str, quiz_ids: list[uuid.UUID]):
    """``(quiz_id, kind, count)`` rows for the requested owned quizzes."""
    return (
        select(StudyQuizQuestionModel.quiz_id, StudyQuizQuestionModel.kind, func.count(StudyQuizQuestionModel.id))
        .where(StudyQuizQuestionModel.user_id == user_id, StudyQuizQuestionModel.quiz_id.in_(quiz_ids))
        .group_by(StudyQuizQuestionModel.quiz_id, StudyQuizQuestionModel.kind)
    )


def attempt_stats_by_quiz(*, user_id: str, quiz_ids: list[uuid.UUID]):
    """``(quiz_id, attempt count, best fraction, newest fraction)`` for owned quizzes with attempts."""
    fraction = StudyQuizAttemptModel.score / StudyQuizAttemptModel.question_count
    ranked = (
        select(
            StudyQuizAttemptModel.quiz_id.label("quiz_id"),
            fraction.label("fraction"),
            func.row_number()
            .over(
                partition_by=StudyQuizAttemptModel.quiz_id,
                order_by=(StudyQuizAttemptModel.submitted_at.desc(), StudyQuizAttemptModel.id.desc()),
            )
            .label("recency"),
        )
        .where(StudyQuizAttemptModel.user_id == user_id, StudyQuizAttemptModel.quiz_id.in_(quiz_ids))
        .subquery()
    )
    return select(
        ranked.c.quiz_id,
        func.count(),
        func.max(ranked.c.fraction),
        func.max(case((ranked.c.recency == 1, ranked.c.fraction))),
    ).group_by(ranked.c.quiz_id)
