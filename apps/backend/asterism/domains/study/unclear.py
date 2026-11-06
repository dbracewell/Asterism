"""Turning a reflection's "still unclear" items into practice (US-58.4, ADR-0050).

Each request creates one card the learner confirmed; nothing is converted in
bulk or by a model. The card is due for review at once. With ``weak_spot`` it
also counts as a weak spot until recalled: the flag is a weak-spot event of its
own, never a fake review, so scheduling and mastery stay based on real results.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException
from asterism.domains.projects.scope import require_owned_project
from asterism.domains.reflections.models import ReflectionModel
from asterism.domains.reflections.queries import select_owned_reflections

from . import clock
from .models import StudyCardModel, StudyDeckModel
from .queries import select_deck_by_name, select_reflection_card
from .schemas import StudyCard, StudyUnclearCardCreate
from .service import require_deck, to_cards

logger = get_logger("StudyUnclear")

UNCLEAR_DECK_NAME = "Unclear items"


async def _deck(
    *, user_id: str, project_id: uuid.UUID, deck_id: uuid.UUID | None, session: AsyncSession
) -> StudyDeckModel:
    if deck_id is not None:
        return await require_deck(user_id=user_id, project_id=project_id, deck_id=deck_id, session=session)
    deck = await session.scalar(select_deck_by_name(user_id=user_id, project_id=project_id, name=UNCLEAR_DECK_NAME))
    if deck is None:
        deck = StudyDeckModel(
            user_id=user_id,
            project_id=project_id,
            name=UNCLEAR_DECK_NAME,
            description="Cards from the things your reflections said were still unclear.",
        )
        session.add(deck)
        await session.flush()
    return deck


async def create_unclear_card(
    *, user_id: str, project_id: uuid.UUID, payload: StudyUnclearCardCreate, session: AsyncSession
) -> StudyCard:
    """Create one confirmed card; 404 for a foreign reflection, 409 if this item was already added."""
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    reflection = await session.scalar(
        select_owned_reflections(user_id).where(ReflectionModel.id == payload.reflection_id)
    )
    if reflection is None:
        raise NotFoundException("Reflection not found")
    if reflection.project_id != project_id:
        raise BadDataException("This reflection belongs to another project")
    if not reflection.unclear.strip():
        raise BadDataException("This reflection has no unclear items")
    duplicate = await session.scalar(
        select_reflection_card(user_id=user_id, reflection_id=reflection.id, front=payload.front)
    )
    if duplicate is not None:
        raise ConflictException("This item is already a card")
    deck = await _deck(user_id=user_id, project_id=project_id, deck_id=payload.deck_id, session=session)
    card = StudyCardModel(
        user_id=user_id,
        deck_id=deck.id,
        front=payload.front,
        back=payload.back,
        source_reflection_id=reflection.id,
        flagged_unclear_at=clock.now_seconds() if payload.weak_spot else None,
    )
    session.add(card)
    await session.commit()
    logger.info(f"Created card {card.id} from reflection {reflection.id} for user {user_id}")
    return (await to_cards(user_id=user_id, project_id=project_id, rows=[card], session=session))[0]
