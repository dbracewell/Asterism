"""Owner-scoped base selects for study records. Callers filter before pagination."""

import uuid

from sqlalchemy import case, func, select

from .models import StudyCardModel, StudyDeckModel


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
