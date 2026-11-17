"""The combined progress read of one project (ADR-0067).

Topics (ADR-0049), weak spots (ADR-0036) and pending unclear items (ADR-0050)
come from one request so they agree. Everything is derived on read; nothing is
stored or read by agents.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.projects.scope import require_owned_project

from . import clock, mastery, unclear, weak_spots
from .schemas import MAX_UNCLEAR_ITEMS, MAX_WEAK_SPOTS, StudyProgress


async def project_progress(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> StudyProgress:
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    topics = await mastery.load_topics(user_id=user_id, project_id=project_id, session=session)
    history = await mastery.load_history(user_id=user_id, project_id=project_id, session=session)
    now = clock.now_seconds()
    return StudyProgress(
        topics=mastery.topic_mastery(topics, history, now),
        weak_spots=await weak_spots.weak_spots(
            user_id=user_id,
            project_id=project_id,
            limit=MAX_WEAK_SPOTS,
            item_topics=mastery.item_topics(topics),
            session=session,
        ),
        unclear=await unclear.pending_unclear_items(
            user_id=user_id, project_id=project_id, limit=MAX_UNCLEAR_ITEMS, session=session
        ),
        computed_at=now,
    )
