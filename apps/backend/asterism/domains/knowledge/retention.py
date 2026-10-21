"""Retention of superseded knowledge-artifact generations.

Every processing-policy change mints a new artifact generation for the whole
library, and each generation owns its own chunk vectors. Without a retention
window those generations (and their vectors) accumulate forever.

The window keeps the *current* generation plus a configurable number of
superseded ones, and prunes the rest. Two rules make pruning safe:

- The current generation is never pruned; it is what retrieval serves.
- Generations whose work is still in flight (``pending``/``processing``) are
  never pruned, so a running worker is never pulled out from under itself.

Vectors are removed before the row that describes them: a row without vectors
is recoverable (the next prune retries it), whereas vectors without a row are
unreachable orphans that nothing can ever reclaim.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core import config
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel, FileKnowledgeArtifactStatus
from asterism.domains.knowledge.vector_store import VectorStore, vector_store

logger = get_logger("KnowledgeRetention")

_IN_FLIGHT_STATUSES = (FileKnowledgeArtifactStatus.PENDING, FileKnowledgeArtifactStatus.PROCESSING)
"""Generation states whose work may still be running; never pruned."""


def generations_to_prune(
    generations: Sequence[tuple[int, bool, FileKnowledgeArtifactStatus]],
    *,
    keep_previous: int,
) -> list[int]:
    """Select the generation numbers that fall outside the retention window.

    This is the pure retention rule, kept separate from the database work so
    it can be reasoned about (and tested) in isolation.

    Args:
        generations: ``(generation, is_current, status)`` triples for one file.
        keep_previous: Number of superseded generations to keep. ``0`` keeps
            only the current generation.

    Returns:
        The generation numbers to prune, oldest first.
    """
    if keep_previous < 0:
        raise ValueError("Retention window cannot be negative")
    superseded = sorted((generation, status) for generation, is_current, status in generations if not is_current)
    if not superseded:
        return []
    keep = {generation for generation, _ in superseded[-keep_previous:]} if keep_previous else set()
    keep |= {generation for generation, status in superseded if status in _IN_FLIGHT_STATUSES}
    return [generation for generation, _ in superseded if generation not in keep]


async def prune_superseded_generations(
    *,
    user_id: str,
    file_id: uuid.UUID,
    session: AsyncSession,
    keep_previous: int | None = None,
    store: VectorStore = vector_store,
) -> int:
    """Delete the generations of one file that fall outside the retention window.

    The window is the current generation plus the ``keep_previous`` newest
    superseded generations. In-flight generations are kept regardless of their
    position, and the current generation is always kept.

    Args:
        user_id: Owner of the file; scopes the vector deletions.
        file_id: File whose generations are pruned.
        session: Active async session; the row deletions are committed here.
        keep_previous: Number of superseded generations to keep. Defaults to
            ``config.knowledge_generation_retention``.
        store: Vector store used to drop the pruned generations' chunks.

    Returns:
        The number of generations that were pruned.
    """
    retention = config.knowledge_generation_retention if keep_previous is None else keep_previous
    rows = (
        await session.execute(
            select(
                FileKnowledgeArtifactModel.id,
                FileKnowledgeArtifactModel.generation,
                FileKnowledgeArtifactModel.status,
                FileKnowledgeArtifactModel.is_current,
            ).where(FileKnowledgeArtifactModel.file_id == file_id),
        )
    ).all()
    if not rows:
        return 0

    pruned_generations = set(
        generations_to_prune(
            [(row.generation, row.is_current, row.status) for row in rows],
            keep_previous=retention,
        ),
    )
    if not pruned_generations:
        return 0

    removed = 0
    for row in rows:
        if row.generation not in pruned_generations:
            continue
        try:
            await store.delete_file_generation(
                user_id=user_id,
                file_id=str(file_id),
                artifact_generation=row.generation,
            )
        except Exception:
            # Keep the row so the vectors stay addressable and the next prune
            # can retry the deletion.
            logger.warning(
                "Could not remove superseded knowledge vectors",
                extra={"file_id": str(file_id), "generation": row.generation},
            )
            continue
        await session.execute(
            delete(FileKnowledgeArtifactModel).where(FileKnowledgeArtifactModel.id == row.id),
        )
        removed += 1
    if removed:
        await session.commit()
    return removed
