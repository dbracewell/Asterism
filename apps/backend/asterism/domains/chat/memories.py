"""A turn's memories, between the chat and memory domains (ADR-0078, US-93.5).

Accepting a turn pins the memories it will use; preparing a run records their
ids; running builds the memory layer from the pins. Availability (the admin
policy, group, the person's setting and the course) is checked live at each step.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.agent.prompts import PromptLayer, memory_layer
from asterism.domains.memory.policy import memory_available
from asterism.domains.memory.turns import (
    pin_turn_memories,
    read_pinned_memories,
    repin_turn_memories,
    select_turn_memories,
)

from .models import ChatModel, MessageModel
from .schemas import MemoryUse, MessageExecution


async def pin_accepted_memories(
    *, user_id: str, chat: ChatModel, prompt: str, message_ids: Sequence[uuid.UUID], session: AsyncSession
) -> None:
    """Pin the memories a newly accepted turn will use, when memory is on here."""
    if chat.purpose != "conversation":
        return
    if not (await memory_available(user_id, session, project_id=chat.project_id)).available:
        return
    memories = await select_turn_memories(user_id=user_id, project_id=chat.project_id, prompt=prompt, session=session)
    await pin_turn_memories(user_id=user_id, message_ids=message_ids, memories=memories, session=session)


async def prepare_run_memories(
    *, user_id: str, chat: ChatModel, message: MessageModel, restart: bool, session: AsyncSession
) -> list[MemoryUse]:
    """The memories a run is prepared with. A first run uses the turn's pins; a
    regeneration selects again and re-pins. None when memory is off here now."""
    if chat.purpose != "conversation":
        return []
    if not (await memory_available(user_id, session, project_id=chat.project_id)).available:
        return []
    if restart:
        memories = await select_turn_memories(
            user_id=user_id, project_id=chat.project_id, prompt=message.content or "", session=session
        )
        await repin_turn_memories(user_id=user_id, message_id=message.id, memories=memories, session=session)
        return [MemoryUse(id=memory.id, revision=memory.revision) for memory in memories]
    pins = await read_pinned_memories(user_id=user_id, message_id=message.id, session=session)
    return [MemoryUse(id=pin.memory_id, revision=pin.revision) for pin in pins]


async def read_execution_memory_layer(
    *, user_id: str, chat_id: uuid.UUID, execution: MessageExecution, session: AsyncSession | None = None
) -> PromptLayer | None:
    """The memory layer for a recorded run: the memories it was prepared with, as
    pinned then, minus any deleted since. None when memory is off here now."""
    if not execution.memories:
        return None
    from asterism.db.database import get_async_db_session
    from asterism.domains.memory.policy import chat_memory_available

    async with get_async_db_session(session) as db:
        if not (await chat_memory_available(user_id, chat_id, db)).available:
            return None
        pins = await read_pinned_memories(
            user_id=user_id,
            message_id=execution.request_message_id,
            session=db,
            recorded=[(item.id, item.revision) for item in execution.memories],
        )
    return memory_layer([pin.text for pin in pins])
