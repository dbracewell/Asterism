"""Choosing a turn's memories and pinning them on its message (ADR-0078, US-93.5).

A turn gets the person's user memories, plus its project's memories in a
project chat, never another project's. When there are few, it gets all of them;
otherwise the ones nearest the prompt, within a count and token budget. The
chosen memories are pinned on the accepted message (``message_memories``), so a
resume sends what was accepted even after an edit, and nothing for a memory
deleted since. Logs name ids and counts, never text.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.domains.knowledge.embedding import embedding_provider
from asterism.domains.llm.token_counting import estimate_text_tokens

from .models import MemoryKind, MemoryModel, MessageMemoryModel
from .queries import order_memories, select_owned_memories
from .vectors import memory_vector_store

logger = get_logger("Memory")

# At most this many memories, and this many tokens of memory text, per turn.
MAX_TURN_MEMORIES = 8
MAX_TURN_MEMORY_TOKENS = 1_000


@dataclass(frozen=True)
class PinnedMemory:
    memory_id: uuid.UUID
    revision: int
    text: str


def _candidates(user_id: str, project_id: uuid.UUID | None):
    statement = select_owned_memories(user_id)
    if project_id is None:
        statement = statement.where(MemoryModel.kind == MemoryKind.USER)
    else:
        statement = statement.where(
            or_(
                MemoryModel.kind == MemoryKind.USER,
                (MemoryModel.kind == MemoryKind.PROJECT) & (MemoryModel.project_id == project_id),
            )
        )
    return order_memories(statement)


async def _ranked_ids(user_id: str, project_id: uuid.UUID | None, prompt: str, limit: int) -> list[str]:
    """Nearest memory ids by embedding; empty when the model or vectors aren't ready."""
    if not prompt.strip():
        return []
    try:
        [vector] = await embedding_provider.embed_query([prompt])
        return await memory_vector_store.search(user_id=user_id, project_id=project_id, vector=vector, limit=limit)
    except Exception as error:
        logger.info(f"Memories for user {user_id} ranked by recency ({type(error).__name__})")
        return []


def _within_budget(memories: Sequence[MemoryModel]) -> list[MemoryModel]:
    chosen: list[MemoryModel] = []
    tokens = 0
    for memory in memories:
        if len(chosen) == MAX_TURN_MEMORIES:
            break
        cost = estimate_text_tokens(memory.text)
        if tokens + cost > MAX_TURN_MEMORY_TOKENS:
            continue
        chosen.append(memory)
        tokens += cost
    return chosen


async def select_turn_memories(
    *, user_id: str, project_id: uuid.UUID | None, prompt: str, session: AsyncSession
) -> list[MemoryModel]:
    """The memories for a turn, most relevant first. The caller checks availability."""
    candidates = list((await session.scalars(_candidates(user_id, project_id))).all())
    if len(candidates) > MAX_TURN_MEMORIES:
        ranked = await _ranked_ids(user_id, project_id, prompt, limit=len(candidates))
        order = {memory_id: index for index, memory_id in enumerate(ranked)}
        # Ranked ones first; any without a vector keep their recency order after them.
        candidates.sort(key=lambda memory: order.get(str(memory.id), len(order)))
    return _within_budget(candidates)


async def pin_turn_memories(
    *, user_id: str, message_ids: Sequence[uuid.UUID], memories: Sequence[MemoryModel], session: AsyncSession
) -> None:
    """Pin the memories, as they are now, on each of the turn's messages."""
    for message_id in message_ids:
        session.add_all(
            MessageMemoryModel(
                user_id=user_id,
                message_id=message_id,
                memory_id=memory.id,
                revision=memory.revision,
                text=memory.text,
                position=position,
            )
            for position, memory in enumerate(memories)
        )
    if memories:
        logger.info(f"Pinned {len(memories)} memories on {len(message_ids)} messages for user {user_id}")


async def repin_turn_memories(
    *, user_id: str, message_id: uuid.UUID, memories: Sequence[MemoryModel], session: AsyncSession
) -> None:
    """Replace a turn's pinned memories, for a regeneration."""
    await session.execute(
        delete(MessageMemoryModel).where(
            MessageMemoryModel.user_id == user_id, MessageMemoryModel.message_id == message_id
        )
    )
    await pin_turn_memories(user_id=user_id, message_ids=[message_id], memories=memories, session=session)


async def copy_pinned_memories(
    *, user_id: str, source_message_id: uuid.UUID, message_ids: Sequence[uuid.UUID], session: AsyncSession
) -> None:
    """Give new messages of the same turn (comparison columns) the source's pins."""
    pins = await read_pinned_memories(user_id=user_id, message_id=source_message_id, session=session)
    for message_id in message_ids:
        session.add_all(
            MessageMemoryModel(
                user_id=user_id,
                message_id=message_id,
                memory_id=pin.memory_id,
                revision=pin.revision,
                text=pin.text,
                position=position,
            )
            for position, pin in enumerate(pins)
        )


async def read_pinned_memories(
    *,
    user_id: str,
    message_id: uuid.UUID,
    session: AsyncSession,
    recorded: Sequence[tuple[uuid.UUID, int]] | None = None,
) -> list[PinnedMemory]:
    """A message's pinned memories, in order. With ``recorded``, only those ids at
    those revisions: what an execution was prepared with, minus any deleted since."""
    rows = (
        await session.scalars(
            select(MessageMemoryModel)
            .where(MessageMemoryModel.user_id == user_id, MessageMemoryModel.message_id == message_id)
            .order_by(MessageMemoryModel.position)
        )
    ).all()
    pins = [PinnedMemory(memory_id=row.memory_id, revision=row.revision, text=row.text) for row in rows]
    if recorded is None:
        return pins
    wanted = set(recorded)
    return [pin for pin in pins if (pin.memory_id, pin.revision) in wanted]
