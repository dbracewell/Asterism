"""Rebuild memory vectors from the memory rows (US-93.6, ADR-0078).

The vectors are a cache of the memory text. A memory saved while the embedding
model wasn't ready, or restored from a backup taken while it was being saved,
has no vector (or one from an older revision); a vector whose memory is gone is
left over. On every start, in the background, each owner's vectors are brought
back in line with their rows. Logs name counts and ids, never text.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.events import Event, EventType, event_bus

from . import service
from .models import MemoryModel
from .queries import order_memories, select_owned_memories

logger = get_logger("Memory")


@dataclass
class RebuildResult:
    rebuilt: int = 0
    failed: int = 0
    removed: int = 0


async def rebuild_memory_vectors(session: AsyncSession) -> RebuildResult:
    """Embed each memory without a current vector and drop vectors without a memory."""
    result = RebuildResult()
    embedding = True
    owners = set((await session.scalars(select(MemoryModel.user_id).distinct())).all())
    owners |= await service.memory_vector_store.list_owners()
    for user_id in sorted(owners):
        stored = await service.memory_vector_store.list_revisions(user_id=user_id)
        rows = (await session.scalars(order_memories(select_owned_memories(user_id)))).all()
        for row in rows:
            if stored.pop(str(row.id), None) == row.revision:
                continue
            # After one failure the model isn't ready: count the rest, try them on the next start.
            embedding = embedding and await service.write_vector(row)
            if embedding:
                result.rebuilt += 1
            else:
                result.failed += 1
        if stored:
            await service.memory_vector_store.delete_memories(user_id=user_id, memory_ids=list(stored))
            result.removed += len(stored)
        session.expunge_all()
    return result


@event_bus.on(EventType.SYSTEM_START)
async def _rebuild_on_start(_: Event) -> None:
    from asterism.db.database import get_async_db_session

    try:
        async with get_async_db_session() as session:
            result = await rebuild_memory_vectors(session)
    except Exception as error:
        logger.warning(f"Memory vectors were not checked ({type(error).__name__}); the next start tries again")
        return
    if result.rebuilt or result.failed or result.removed:
        logger.info(
            f"Memory vectors: {result.rebuilt} rebuilt, {result.failed} not rebuilt, {result.removed} left over removed"
        )
