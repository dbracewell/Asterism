"""A published, results-only reader for class insights (US-60.5, ADR-0056).

It gives, per cited file, one learner's mean latest practice score in one
project, the same score topic mastery uses (ADR-0049). It returns no item text,
answers, timings or chat content, and callers aggregate it across learners
before anyone sees it.
"""

import uuid
from collections import defaultdict

from sqlalchemy.ext.asyncio import AsyncSession

from . import clock
from .citations import parse_citations
from .mastery import Item, _history, latest_scores, mean
from .queries import select_cited_cards, select_cited_questions


async def scores_by_cited_file(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> dict[uuid.UUID, float]:
    """The learner's mean latest score over practiced items citing each file."""
    items_by_file: dict[uuid.UUID, list[Item]] = defaultdict(list)
    for kind, statement in (
        ("card", select_cited_cards(user_id=user_id, project_id=project_id)),
        ("question", select_cited_questions(user_id=user_id, project_id=project_id)),
    ):
        for item_id, citations in (await session.execute(statement)).tuples():
            for file_id in {citation.file_id for citation in parse_citations(citations)}:
                items_by_file[file_id].append((kind, item_id))
    if not items_by_file:
        return {}
    history = await _history(user_id=user_id, project_id=project_id, session=session)
    now = clock.now_seconds()
    result = {}
    for file_id, items in items_by_file.items():
        score = mean(list(latest_scores(items, history, now).values()))
        if score is not None:
            result[file_id] = score
    return result
