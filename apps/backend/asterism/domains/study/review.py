"""Spaced-repetition review: due queues, previews and ratings (US-53.3, ADR-0033).

A rating updates the card's scheduler state with a compare-and-set on ``reps``
and appends one review log row in the same transaction. Review history is a
user-owned record; no agent or prompt path reads it.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import ConflictException

from . import clock
from .models import StudyCardModel, StudyReviewLogModel
from .queries import select_due_cards
from .scheduling import DEFAULT_SCHEDULER, CardState, Rating, Scheduler, ScheduleState
from .schemas import (
    StudyCard,
    StudyRating,
    StudyReviewCard,
    StudyReviewPreview,
    StudyReviewQueue,
    StudyReviewRequest,
)
from .service import require_card, require_deck, to_cards

logger = get_logger("StudyReview")

RATINGS: dict[StudyRating, Rating] = {
    "again": Rating.AGAIN,
    "hard": Rating.HARD,
    "good": Rating.GOOD,
    "easy": Rating.EASY,
}


def _datetime(seconds: int | None) -> datetime | None:
    return datetime.fromtimestamp(seconds, UTC) if seconds is not None else None


def _seconds(value: datetime | None) -> int:
    assert value is not None
    return int(value.timestamp())


def schedule_state(card: StudyCardModel) -> ScheduleState:
    return ScheduleState(
        state=CardState(card.state),
        step=card.step,
        stability=card.stability,
        difficulty=card.difficulty,
        due_at=_datetime(card.due_at),
        last_reviewed_at=_datetime(card.last_reviewed_at),
    )


def previews(card: StudyCardModel, now: int, scheduler: Scheduler = DEFAULT_SCHEDULER) -> StudyReviewPreview:
    state, moment = schedule_state(card), _datetime(now)
    assert moment is not None
    due = {name: _seconds(scheduler.schedule(state, rating, moment).due_at) for name, rating in RATINGS.items()}
    return StudyReviewPreview(**due)


def _review_card(card: StudyCard, row: StudyCardModel, now: int) -> StudyReviewCard:
    return StudyReviewCard(**card.model_dump(), previews=previews(row, now))


async def review_queue(
    *, user_id: str, project_id: uuid.UUID, deck_id: uuid.UUID, limit: int, session: AsyncSession
) -> StudyReviewQueue:
    await require_deck(user_id=user_id, project_id=project_id, deck_id=deck_id, session=session)
    now = clock.now_seconds()
    statement = select_due_cards(user_id=user_id, deck_id=deck_id, now=now)
    due_count = await session.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    rows = list(await session.scalars(statement.limit(limit)))
    cards = await to_cards(user_id=user_id, project_id=project_id, rows=rows, session=session)
    return StudyReviewQueue(
        items=[_review_card(card, row, now) for card, row in zip(cards, rows, strict=True)],
        due_count=due_count or 0,
        now=now,
    )


async def rate_card(
    *,
    user_id: str,
    project_id: uuid.UUID,
    deck_id: uuid.UUID,
    card_id: uuid.UUID,
    payload: StudyReviewRequest,
    session: AsyncSession,
    scheduler: Scheduler = DEFAULT_SCHEDULER,
) -> StudyReviewCard:
    card = await require_card(user_id=user_id, project_id=project_id, deck_id=deck_id, card_id=card_id, session=session)
    if card.reps != payload.expected_reps:
        raise ConflictException("This card was already reviewed; continue with the next card")
    now = clock.now_seconds()
    rating = RATINGS[payload.rating]
    previous_state, previous_due = card.state, card.due_at
    moment = _datetime(now)
    assert moment is not None
    after = scheduler.schedule(schedule_state(card), rating, moment)
    assert after.stability is not None and after.difficulty is not None
    lapsed = previous_state == CardState.REVIEW and rating == Rating.AGAIN
    result = await session.execute(
        update(StudyCardModel)
        .where(
            StudyCardModel.id == card_id,
            StudyCardModel.user_id == user_id,
            StudyCardModel.deck_id == deck_id,
            StudyCardModel.reps == payload.expected_reps,
        )
        .values(
            state=after.state.value,
            step=after.step,
            stability=after.stability,
            difficulty=after.difficulty,
            due_at=_seconds(after.due_at),
            last_reviewed_at=now,
            reps=StudyCardModel.reps + 1,
            lapses=StudyCardModel.lapses + (1 if lapsed else 0),
        )
        .returning(StudyCardModel.id)
        .execution_options(synchronize_session="fetch")
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        raise ConflictException("This card was already reviewed; continue with the next card")
    session.add(
        StudyReviewLogModel(
            user_id=user_id,
            card_id=card_id,
            rating=int(rating),
            reviewed_at=now,
            previous_state=previous_state,
            previous_due_at=previous_due,
            state=after.state.value,
            due_at=_seconds(after.due_at),
            stability=after.stability,
            difficulty=after.difficulty,
        )
    )
    await session.commit()
    await session.refresh(card)
    logger.info(f"Reviewed study card {card_id} user={user_id} rating={payload.rating}")
    shown = (await to_cards(user_id=user_id, project_id=project_id, rows=[card], session=session))[0]
    return _review_card(shown, card, now)
