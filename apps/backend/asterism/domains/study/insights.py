"""A published, results-only reader for class insights (US-60.5, ADR-0056).

It gives, per cited file, one learner's mean latest practice score in one
project, the same score topic mastery uses (ADR-0049). It returns no item text,
answers, timings or chat content, and callers aggregate it across learners
before anyone sees it.
"""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from itertools import batched

from sqlalchemy.ext.asyncio import AsyncSession

from . import clock
from .citations import parse_citations
from .mastery import Item, latest_scores, mean
from .queries import select_learners_cited_cards, select_learners_cited_questions, select_learners_scored_events

Learner = tuple[str, uuid.UUID]
# Learners read per round of queries, so each query's ID lists stay bounded.
LEARNER_BATCH = 500


async def scores_by_cited_file(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> dict[uuid.UUID, float]:
    """The learner's mean latest score over practiced items citing each file."""
    return (await learners_scores_by_cited_file([(user_id, project_id)], session)).get((user_id, project_id), {})


async def learners_scores_by_cited_file(
    learners: Sequence[Learner], session: AsyncSession
) -> dict[Learner, dict[uuid.UUID, float]]:
    """Each learner's :func:`scores_by_cited_file` in their project, in three queries per batch of learners."""
    now = clock.now_seconds()
    result: dict[Learner, dict[uuid.UUID, float]] = {}
    for batch in batched(dict.fromkeys(learners), LEARNER_BATCH):
        wanted = set(batch)
        user_ids = sorted({user_id for user_id, _ in batch})
        project_ids = sorted({project_id for _, project_id in batch})
        items_by_file: dict[Learner, dict[uuid.UUID, list[Item]]] = defaultdict(lambda: defaultdict(list))
        for kind, statement in (
            ("card", select_learners_cited_cards(user_ids=user_ids, project_ids=project_ids)),
            ("question", select_learners_cited_questions(user_ids=user_ids, project_ids=project_ids)),
        ):
            for user_id, project_id, item_id, citations in (await session.execute(statement)).tuples():
                if (user_id, project_id) not in wanted:
                    continue
                for file_id in {citation.file_id for citation in parse_citations(citations)}:
                    items_by_file[(user_id, project_id)][file_id].append((kind, item_id))
        if not items_by_file:
            continue
        histories: dict[Learner, dict[Item, list[tuple[int, float]]]] = defaultdict(lambda: defaultdict(list))
        statement = select_learners_scored_events(
            user_ids=sorted({user_id for user_id, _ in items_by_file}),
            project_ids=sorted({project_id for _, project_id in items_by_file}),
        )
        for user_id, project_id, kind, root_id, at, score in (await session.execute(statement)).tuples():
            if (user_id, project_id) in items_by_file:
                histories[(user_id, project_id)][(kind, root_id)].append((at, float(score)))
        for learner, by_file in items_by_file.items():
            scores = {}
            for file_id, items in by_file.items():
                score = mean(list(latest_scores(items, histories[learner], now).values()))
                if score is not None:
                    scores[file_id] = score
            result[learner] = scores
    return result
