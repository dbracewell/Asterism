"""Owner- and project-scoped lifecycle for decks and cards.

Every operation first proves project ownership, then deck membership in that
project. Foreign and missing records are indistinguishable 404s.
"""

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import NotFoundException
from asterism.db.queries import paginate_select
from asterism.domains.projects.scope import require_owned_project

from . import clock
from .citations import resolve_citations, serialize_citations
from .models import StudyCardModel, StudyDeckModel
from .queries import (
    count_cards_by_deck,
    count_due_by_deck,
    project_card_totals,
    select_owned_cards,
    select_owned_decks,
)
from .schemas import (
    StudyCard,
    StudyCardCreate,
    StudyCardPage,
    StudyCardUpdate,
    StudyDeck,
    StudyDeckCreate,
    StudyDeckPage,
    StudyDeckUpdate,
    StudyProjectSummary,
)

logger = get_logger("Study")


# --- Lookups ---------------------------------------------------------------


async def require_deck(
    *, user_id: str, project_id: uuid.UUID, deck_id: uuid.UUID, session: AsyncSession
) -> StudyDeckModel:
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    deck = await session.scalar(
        select_owned_decks(user_id=user_id, project_id=project_id).where(StudyDeckModel.id == deck_id)
    )
    if deck is None:
        raise NotFoundException("Deck not found")
    return deck


async def require_card(
    *, user_id: str, project_id: uuid.UUID, deck_id: uuid.UUID, card_id: uuid.UUID, session: AsyncSession
) -> StudyCardModel:
    await require_deck(user_id=user_id, project_id=project_id, deck_id=deck_id, session=session)
    card = await session.scalar(
        select_owned_cards(user_id=user_id, deck_id=deck_id).where(StudyCardModel.id == card_id)
    )
    if card is None:
        raise NotFoundException("Card not found")
    return card


# --- Response enrichment ---------------------------------------------------


async def _to_decks(*, user_id: str, rows: list[StudyDeckModel], session: AsyncSession) -> list[StudyDeck]:
    counts: dict[uuid.UUID, int] = {}
    due: dict[uuid.UUID, int] = {}
    if rows:
        deck_ids = [row.id for row in rows]
        result = await session.execute(count_cards_by_deck(user_id=user_id, deck_ids=deck_ids))
        counts = {deck_id: count for deck_id, count in result.tuples()}
        result = await session.execute(count_due_by_deck(user_id=user_id, deck_ids=deck_ids, now=clock.now_seconds()))
        due = {deck_id: count for deck_id, count in result.tuples()}
    return [
        StudyDeck(
            id=row.id,
            project_id=row.project_id,
            name=row.name,
            description=row.description,
            tags=row.tags,
            card_count=counts.get(row.id, 0),
            due_count=due.get(row.id, 0),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        for row in rows
    ]


async def to_cards(
    *, user_id: str, project_id: uuid.UUID, rows: list[StudyCardModel], session: AsyncSession
) -> list[StudyCard]:
    citations = await resolve_citations(
        user_id=user_id, project_id=project_id, stored=[row.citations for row in rows], session=session
    )
    return [
        StudyCard(
            id=row.id,
            deck_id=row.deck_id,
            front=row.front,
            back=row.back,
            citations=card_citations,
            state=row.state,  # pyright: ignore[reportArgumentType]  # DB check constraint pins the values.
            due_at=row.due_at,
            reps=row.reps,
            lapses=row.lapses,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        for row, card_citations in zip(rows, citations, strict=True)
    ]


# --- Decks -----------------------------------------------------------------


async def project_summary(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> StudyProjectSummary:
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    deck_count = await session.scalar(
        select(func.count()).select_from(select_owned_decks(user_id=user_id, project_id=project_id).subquery())
    )
    row = (
        await session.execute(project_card_totals(user_id=user_id, project_id=project_id, now=clock.now_seconds()))
    ).one()
    return StudyProjectSummary(deck_count=deck_count or 0, card_count=row[0], due_count=row[1])


async def list_decks(
    *, user_id: str, project_id: uuid.UUID, page: int, page_size: int, session: AsyncSession
) -> StudyDeckPage:
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    result = await paginate_select(
        statement=select_owned_decks(user_id=user_id, project_id=project_id).order_by(
            StudyDeckModel.updated_at.desc(), StudyDeckModel.id
        ),
        session=session,
        page=page,
        page_size=page_size,
    )
    return StudyDeckPage(
        items=await _to_decks(user_id=user_id, rows=result.records, session=session),
        total=result.total,
        page=page,
        page_size=page_size,
    )


async def read_deck(*, user_id: str, project_id: uuid.UUID, deck_id: uuid.UUID, session: AsyncSession) -> StudyDeck:
    deck = await require_deck(user_id=user_id, project_id=project_id, deck_id=deck_id, session=session)
    return (await _to_decks(user_id=user_id, rows=[deck], session=session))[0]


async def create_deck(
    *, user_id: str, project_id: uuid.UUID, payload: StudyDeckCreate, session: AsyncSession
) -> StudyDeck:
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    deck = StudyDeckModel(user_id=user_id, project_id=project_id, **payload.model_dump())
    session.add(deck)
    await session.commit()
    logger.info(f"Created study deck {deck.id} in project {project_id} for user {user_id}")
    return (await _to_decks(user_id=user_id, rows=[deck], session=session))[0]


async def update_deck(
    *, user_id: str, project_id: uuid.UUID, deck_id: uuid.UUID, payload: StudyDeckUpdate, session: AsyncSession
) -> StudyDeck:
    deck = await require_deck(user_id=user_id, project_id=project_id, deck_id=deck_id, session=session)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(deck, field, value)
    await session.commit()
    return (await _to_decks(user_id=user_id, rows=[deck], session=session))[0]


async def delete_deck(*, user_id: str, project_id: uuid.UUID, deck_id: uuid.UUID, session: AsyncSession) -> None:
    await require_deck(user_id=user_id, project_id=project_id, deck_id=deck_id, session=session)
    # Cards cascade through the composite foreign key.
    await session.execute(
        delete(StudyDeckModel).where(
            StudyDeckModel.id == deck_id,
            StudyDeckModel.user_id == user_id,
            StudyDeckModel.project_id == project_id,
        )
    )
    await session.commit()
    logger.info(f"Deleted study deck {deck_id} in project {project_id} for user {user_id}")


# --- Cards -----------------------------------------------------------------


async def list_cards(
    *, user_id: str, project_id: uuid.UUID, deck_id: uuid.UUID, page: int, page_size: int, session: AsyncSession
) -> StudyCardPage:
    await require_deck(user_id=user_id, project_id=project_id, deck_id=deck_id, session=session)
    result = await paginate_select(
        statement=select_owned_cards(user_id=user_id, deck_id=deck_id).order_by(
            StudyCardModel.created_at, StudyCardModel.id
        ),
        session=session,
        page=page,
        page_size=page_size,
    )
    return StudyCardPage(
        items=await to_cards(user_id=user_id, project_id=project_id, rows=result.records, session=session),
        total=result.total,
        page=page,
        page_size=page_size,
    )


async def read_card(
    *, user_id: str, project_id: uuid.UUID, deck_id: uuid.UUID, card_id: uuid.UUID, session: AsyncSession
) -> StudyCard:
    card = await require_card(user_id=user_id, project_id=project_id, deck_id=deck_id, card_id=card_id, session=session)
    return (await to_cards(user_id=user_id, project_id=project_id, rows=[card], session=session))[0]


async def create_card(
    *, user_id: str, project_id: uuid.UUID, deck_id: uuid.UUID, payload: StudyCardCreate, session: AsyncSession
) -> StudyCard:
    await require_deck(user_id=user_id, project_id=project_id, deck_id=deck_id, session=session)
    citations = await serialize_citations(
        user_id=user_id, project_id=project_id, citations=payload.citations, session=session
    )
    card = StudyCardModel(user_id=user_id, deck_id=deck_id, front=payload.front, back=payload.back, citations=citations)
    session.add(card)
    await session.commit()
    return (await to_cards(user_id=user_id, project_id=project_id, rows=[card], session=session))[0]


async def update_card(
    *,
    user_id: str,
    project_id: uuid.UUID,
    deck_id: uuid.UUID,
    card_id: uuid.UUID,
    payload: StudyCardUpdate,
    session: AsyncSession,
) -> StudyCard:
    card = await require_card(user_id=user_id, project_id=project_id, deck_id=deck_id, card_id=card_id, session=session)
    if payload.front is not None:
        card.front = payload.front
    if payload.back is not None:
        card.back = payload.back
    if payload.citations is not None:
        card.citations = await serialize_citations(
            user_id=user_id, project_id=project_id, citations=payload.citations, session=session
        )
    await session.commit()
    return (await to_cards(user_id=user_id, project_id=project_id, rows=[card], session=session))[0]


async def delete_card(
    *, user_id: str, project_id: uuid.UUID, deck_id: uuid.UUID, card_id: uuid.UUID, session: AsyncSession
) -> None:
    await require_card(user_id=user_id, project_id=project_id, deck_id=deck_id, card_id=card_id, session=session)
    await session.execute(
        delete(StudyCardModel).where(
            StudyCardModel.id == card_id,
            StudyCardModel.user_id == user_id,
            StudyCardModel.deck_id == deck_id,
        )
    )
    await session.commit()
