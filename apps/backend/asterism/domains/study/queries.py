"""Owner-scoped base selects for study records. Callers filter before pagination."""

import uuid

from sqlalchemy import String, and_, case, func, literal, select, union_all

from .models import (
    StudyCardModel,
    StudyDeckModel,
    StudyNoteModel,
    StudyQuizAnswerModel,
    StudyQuizAttemptModel,
    StudyQuizModel,
    StudyQuizQuestionModel,
    StudyReviewLogModel,
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


# --- Weak spots (US-53.5) ----------------------------------------------------

MISSED_VERDICTS = ("incorrect", "partial")
AGAIN_RATING = 1


def _answer_events(*, user_id: str, project_id: uuid.UUID):
    """One row per graded quiz answer in the project, keyed by the item it practices.

    A weak-spot copy counts towards the original question or card it re-asks.
    Ungraded answers say nothing about recall and are left out.
    """
    answer, attempt, question, quiz = (
        StudyQuizAnswerModel,
        StudyQuizAttemptModel,
        StudyQuizQuestionModel,
        StudyQuizModel,
    )
    return (
        select(
            case(
                (question.source_card_id.is_not(None), literal("card", String)), else_=literal("question", String)
            ).label("root_kind"),
            func.coalesce(question.source_card_id, question.source_question_id, question.id).label("root_id"),
            attempt.submitted_at.label("at"),
            attempt.id.label("event_id"),
            case((answer.verdict.in_(MISSED_VERDICTS), 1), else_=0).label("missed"),
            answer.verdict.label("outcome"),
            literal("question", String).label("source_kind"),
            question.id.label("source_id"),
            question.position.label("position"),
            literal(1).label("priority"),
        )
        .select_from(answer)
        .join(attempt, and_(attempt.id == answer.attempt_id, attempt.user_id == answer.user_id))
        .join(question, and_(question.id == answer.question_id, question.user_id == answer.user_id))
        .join(quiz, and_(quiz.id == question.quiz_id, quiz.user_id == question.user_id))
        .where(answer.user_id == user_id, quiz.project_id == project_id, answer.verdict != "ungraded")
    )


def _review_events(*, user_id: str, project_id: uuid.UUID):
    """One row per card rating in the project; Again is a miss."""
    log, card, deck = StudyReviewLogModel, StudyCardModel, StudyDeckModel
    again = log.rating == AGAIN_RATING
    return (
        select(
            literal("card", String).label("root_kind"),
            card.id.label("root_id"),
            log.reviewed_at.label("at"),
            log.id.label("event_id"),
            case((again, 1), else_=0).label("missed"),
            case((again, literal("again", String)), else_=literal("recalled", String)).label("outcome"),
            literal("card", String).label("source_kind"),
            card.id.label("source_id"),
            literal(0).label("position"),
            literal(1).label("priority"),
        )
        .select_from(log)
        .join(card, and_(card.id == log.card_id, card.user_id == log.user_id))
        .join(deck, and_(deck.id == card.deck_id, deck.user_id == card.user_id))
        .where(log.user_id == user_id, deck.project_id == project_id)
    )


def _unclear_events(*, user_id: str, project_id: uuid.UUID):
    """Cards the learner flagged from a reflection (US-58.4); any outcome in the same second wins."""
    card, deck = StudyCardModel, StudyDeckModel
    return (
        select(
            literal("card", String).label("root_kind"),
            card.id.label("root_id"),
            card.flagged_unclear_at.label("at"),
            card.id.label("event_id"),
            literal(1).label("missed"),
            literal("unclear", String).label("outcome"),
            literal("card", String).label("source_kind"),
            card.id.label("source_id"),
            literal(0).label("position"),
            literal(0).label("priority"),
        )
        .select_from(card)
        .join(deck, and_(deck.id == card.deck_id, deck.user_id == card.user_id))
        .where(card.user_id == user_id, deck.project_id == project_id, card.flagged_unclear_at.is_not(None))
    )


def select_weak_spots(*, user_id: str, project_id: uuid.UUID):
    """Items whose latest outcome in the project was a miss, most recent miss first.

    Misses from one attempt keep the quiz's question order.

    Rows: ``root_kind, root_id, at, outcome, source_kind, source_id``. The source is
    the question or card of that latest outcome.
    """
    events = union_all(
        _answer_events(user_id=user_id, project_id=project_id),
        _review_events(user_id=user_id, project_id=project_id),
        _unclear_events(user_id=user_id, project_id=project_id),
    ).subquery()
    ranked = select(
        events,
        func.row_number()
        .over(
            partition_by=(events.c.root_kind, events.c.root_id),
            order_by=(events.c.at.desc(), events.c.priority.desc(), events.c.event_id.desc()),
        )
        .label("recency"),
    ).subquery()
    return (
        select(
            ranked.c.root_kind,
            ranked.c.root_id,
            ranked.c.at,
            ranked.c.outcome,
            ranked.c.source_kind,
            ranked.c.source_id,
        )
        .where(ranked.c.recency == 1, ranked.c.missed == 1)
        .order_by(ranked.c.at.desc(), ranked.c.event_id, ranked.c.position, ranked.c.root_id)
    )


def select_questions_with_quiz_title(*, user_id: str, question_ids: list[uuid.UUID]):
    """``(question, quiz title)`` for owned questions."""
    return (
        select(StudyQuizQuestionModel, StudyQuizModel.title)
        .join(
            StudyQuizModel,
            and_(StudyQuizModel.id == StudyQuizQuestionModel.quiz_id, StudyQuizModel.user_id == user_id),
        )
        .where(StudyQuizQuestionModel.user_id == user_id, StudyQuizQuestionModel.id.in_(question_ids))
    )


def select_cards_with_deck_name(*, user_id: str, card_ids: list[uuid.UUID]):
    """``(card, deck name)`` for owned cards."""
    return (
        select(StudyCardModel, StudyDeckModel.name)
        .join(StudyDeckModel, and_(StudyDeckModel.id == StudyCardModel.deck_id, StudyDeckModel.user_id == user_id))
        .where(StudyCardModel.user_id == user_id, StudyCardModel.id.in_(card_ids))
    )


# --- Notes (US-53.6) -----------------------------------------------------------


def select_owned_notes(*, user_id: str, project_id: uuid.UUID):
    """Notes of one project owned by the caller; unordered so callers can add filters."""
    return select(StudyNoteModel).where(StudyNoteModel.user_id == user_id, StudyNoteModel.project_id == project_id)


# --- Topic mastery (US-58.3) -------------------------------------------------

VERDICT_SCORES = {"correct": 1.0, "partial": 0.5, "incorrect": 0.0}
RATING_SCORES = {1: 0.0, 2: 0.6, 3: 0.9, 4: 1.0}


def _scored_answer_events(*, user_id: str, project_id: uuid.UUID):
    """Graded answers in the project with a 0–1 score, keyed by the item they practice."""
    answer, attempt, question, quiz = (
        StudyQuizAnswerModel,
        StudyQuizAttemptModel,
        StudyQuizQuestionModel,
        StudyQuizModel,
    )
    return (
        select(
            case(
                (question.source_card_id.is_not(None), literal("card", String)), else_=literal("question", String)
            ).label("root_kind"),
            func.coalesce(question.source_card_id, question.source_question_id, question.id).label("root_id"),
            attempt.submitted_at.label("at"),
            case(*((answer.verdict == verdict, score) for verdict, score in VERDICT_SCORES.items()), else_=0.0).label(
                "score"
            ),
        )
        .select_from(answer)
        .join(attempt, and_(attempt.id == answer.attempt_id, attempt.user_id == answer.user_id))
        .join(question, and_(question.id == answer.question_id, question.user_id == answer.user_id))
        .join(quiz, and_(quiz.id == question.quiz_id, quiz.user_id == question.user_id))
        .where(answer.user_id == user_id, quiz.project_id == project_id, answer.verdict != "ungraded")
    )


def _scored_review_events(*, user_id: str, project_id: uuid.UUID):
    """Card ratings in the project with a 0–1 score."""
    log, card, deck = StudyReviewLogModel, StudyCardModel, StudyDeckModel
    return (
        select(
            literal("card", String).label("root_kind"),
            card.id.label("root_id"),
            log.reviewed_at.label("at"),
            case(*((log.rating == rating, score) for rating, score in RATING_SCORES.items()), else_=0.0).label("score"),
        )
        .select_from(log)
        .join(card, and_(card.id == log.card_id, card.user_id == log.user_id))
        .join(deck, and_(deck.id == card.deck_id, deck.user_id == card.user_id))
        .where(log.user_id == user_id, deck.project_id == project_id)
    )


def select_scored_events(*, user_id: str, project_id: uuid.UUID):
    """Rows ``root_kind, root_id, at, score`` for every graded practice event, oldest first."""
    events = union_all(
        _scored_answer_events(user_id=user_id, project_id=project_id),
        _scored_review_events(user_id=user_id, project_id=project_id),
    ).subquery()
    return select(events.c.root_kind, events.c.root_id, events.c.at, events.c.score).order_by(events.c.at)


def select_tagged_cards(*, user_id: str, project_id: uuid.UUID):
    """``(card id, deck tags)`` for cards of the project's decks."""
    return (
        select(StudyCardModel.id, StudyDeckModel.tags)
        .join(StudyDeckModel, and_(StudyDeckModel.id == StudyCardModel.deck_id, StudyDeckModel.user_id == user_id))
        .where(StudyCardModel.user_id == user_id, StudyDeckModel.project_id == project_id)
        .order_by(StudyCardModel.created_at, StudyCardModel.id)
    )


def select_tagged_questions(*, user_id: str, project_id: uuid.UUID):
    """``(question id, quiz tags)`` for original questions; practice copies count towards their originals."""
    return (
        select(StudyQuizQuestionModel.id, StudyQuizModel.tags)
        .join(
            StudyQuizModel, and_(StudyQuizModel.id == StudyQuizQuestionModel.quiz_id, StudyQuizModel.user_id == user_id)
        )
        .where(
            StudyQuizQuestionModel.user_id == user_id,
            StudyQuizModel.project_id == project_id,
            StudyQuizQuestionModel.source_question_id.is_(None),
            StudyQuizQuestionModel.source_card_id.is_(None),
        )
        .order_by(StudyQuizModel.created_at, StudyQuizQuestionModel.position, StudyQuizQuestionModel.id)
    )


def select_cards_by_id(*, user_id: str, card_ids: list[uuid.UUID]):
    return select(StudyCardModel).where(StudyCardModel.user_id == user_id, StudyCardModel.id.in_(card_ids))


def select_questions_by_id(*, user_id: str, question_ids: list[uuid.UUID]):
    return select(StudyQuizQuestionModel).where(
        StudyQuizQuestionModel.user_id == user_id, StudyQuizQuestionModel.id.in_(question_ids)
    )


# --- Unclear items (US-58.4) ---------------------------------------------------


def select_deck_by_name(*, user_id: str, project_id: uuid.UUID, name: str):
    return select_owned_decks(user_id=user_id, project_id=project_id).where(StudyDeckModel.name == name)


def select_reflection_card(*, user_id: str, reflection_id: uuid.UUID, front: str):
    """A card already made from this reflection with this front, in any deck."""
    return select(StudyCardModel.id).where(
        StudyCardModel.user_id == user_id,
        StudyCardModel.source_reflection_id == reflection_id,
        StudyCardModel.front == front,
    )


def select_cited_cards(*, user_id: str, project_id: uuid.UUID):
    """``(card id, citations JSON)`` for cards of the project's decks."""
    return (
        select(StudyCardModel.id, StudyCardModel.citations)
        .join(StudyDeckModel, and_(StudyDeckModel.id == StudyCardModel.deck_id, StudyDeckModel.user_id == user_id))
        .where(StudyCardModel.user_id == user_id, StudyDeckModel.project_id == project_id)
    )


def select_cited_questions(*, user_id: str, project_id: uuid.UUID):
    """``(question id, citations JSON)`` for original questions; copies count towards their originals."""
    return (
        select(StudyQuizQuestionModel.id, StudyQuizQuestionModel.citations)
        .join(
            StudyQuizModel, and_(StudyQuizModel.id == StudyQuizQuestionModel.quiz_id, StudyQuizModel.user_id == user_id)
        )
        .where(
            StudyQuizQuestionModel.user_id == user_id,
            StudyQuizModel.project_id == project_id,
            StudyQuizQuestionModel.source_question_id.is_(None),
            StudyQuizQuestionModel.source_card_id.is_(None),
        )
    )
