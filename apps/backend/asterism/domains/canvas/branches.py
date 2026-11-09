"""Which canvas versions a branch can see (ADR-0063).

A version is anchored to a message and, when the agent wrote it, to the run
that wrote it. It is visible on a branch when its anchor is on the branch and
its run produced a message there or is the run in progress.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, NotFoundException

from .models import CanvasVersionModel


@dataclass(frozen=True)
class Branch:
    message_ids: frozenset[uuid.UUID]
    execution_ids: frozenset[uuid.UUID]
    # The last message: where a user's edit is anchored.
    leaf_id: uuid.UUID | None


def branch_from(messages: Iterable[object], running: uuid.UUID | None = None) -> Branch:
    """A branch from root-to-leaf messages; ``running`` is the run in progress, if any."""
    ordered = list(messages)
    executions = {
        run_id
        for message in ordered
        for run_id in (getattr(message, "execution_id", None), getattr(message, "pending_execution_id", None))
        if run_id is not None
    }
    if running is not None:
        executions.add(running)
    return Branch(
        message_ids=frozenset(getattr(message, "id") for message in ordered),
        execution_ids=frozenset(executions),
        leaf_id=getattr(ordered[-1], "id") if ordered else None,
    )


def is_visible(version: CanvasVersionModel, branch: Branch) -> bool:
    if version.message_id not in branch.message_ids:
        return False
    return version.execution_id is None or version.execution_id in branch.execution_ids


async def active_branch(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> Branch:
    """The chat's active branch, as the user sees it."""
    from asterism.domains.chat.branches import active_branch as chat_active_branch
    from asterism.domains.chat.models import ChatModel, MessageModel
    from asterism.domains.chat.queries import select_owned_chats, select_owned_messages

    chat = await session.scalar(select_owned_chats(user_id=user_id).where(ChatModel.id == chat_id))
    if chat is None:
        raise NotFoundException("Chat not found")
    records = list(await session.scalars(select_owned_messages(user_id=user_id, chat_id=chat_id)))
    by_id: dict[uuid.UUID, MessageModel] = {record.id: record for record in records}
    path = [by_id[message.id] for message in chat_active_branch(records, chat.active_root_id)]
    return branch_from(path)


async def run_branch(
    user_id: str, chat_id: uuid.UUID, request_message_id: uuid.UUID, execution_id: uuid.UUID, session: AsyncSession
) -> Branch:
    """The branch a run works on: its request message and that message's ancestors."""
    from asterism.domains.chat.models import MessageModel
    from asterism.domains.chat.queries import select_owned_messages

    records = {
        record.id: record for record in await session.scalars(select_owned_messages(user_id=user_id, chat_id=chat_id))
    }
    path: list[MessageModel] = []
    current = records.get(request_message_id)
    if current is None:
        raise BadDataException("The run's request message is not in this chat")
    seen: set[uuid.UUID] = set()
    while current is not None:
        if current.id in seen:
            raise BadDataException("Invalid message branch")
        seen.add(current.id)
        path.append(current)
        current = records.get(current.parent_message_id) if current.parent_message_id else None
    path.reverse()
    return branch_from(path, running=execution_id)
