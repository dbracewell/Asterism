"""One deterministic branch traversal for chat presentation and file provenance."""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, CodedException

from .models import ChatModel, MessageModel
from .queries import select_owned_messages
from .schemas import Message


def sibling_order(message: MessageModel) -> tuple[int, int, str]:
    """Creation order; comparison columns created together keep their column order."""
    return (message.created_at, message.comparison_index or 0, str(message.id))


def active_branch(records: Sequence[MessageModel], active_root_id: uuid.UUID | None = None) -> list[Message]:
    """The active branch: from the active root, follow each turn's active child.

    ``active_root_id`` selects among sibling roots (comparison columns at the
    start of a chat); otherwise, or when it is not a root, the oldest root.
    """
    by_id = {message.id: message for message in records}
    children: dict[uuid.UUID | None, list[MessageModel]] = {}
    for message in records:
        children.setdefault(message.parent_message_id, []).append(message)
    for siblings in children.values():
        siblings.sort(key=sibling_order)
    roots = children.get(None, [])
    if not roots:
        return []
    chosen = by_id.get(active_root_id) if active_root_id is not None else None
    current = chosen if chosen is not None and chosen.parent_message_id is None else roots[0]
    visited: set[uuid.UUID] = set()
    result = []
    while current is not None:
        if current.id in visited:
            raise BadDataException("Invalid active message branch")
        visited.add(current.id)
        siblings = children[current.parent_message_id]
        index = siblings.index(current)
        message = Message.model_validate(current)
        message.has_siblings = len(siblings) > 1
        message.sibling_count = len(siblings)
        message.current_sibling_index = index + 1
        message.previous_sibling_id = siblings[index - 1].id if index else None
        message.next_sibling_id = siblings[index + 1].id if index + 1 < len(siblings) else None
        result.append(message)
        child = by_id.get(current.active_child_id)
        if child is None:
            break
        if child.parent_message_id != current.id:
            raise BadDataException("Invalid active message branch")
        current = child
    return result


def branch_to(records: Sequence[MessageModel], message_id: uuid.UUID) -> list[Message]:
    """The path from the root to ``message_id`` (used to run a non-active comparison column)."""
    by_id = {message.id: message for message in records}
    path: list[MessageModel] = []
    current = by_id.get(message_id)
    while current is not None:
        if len(path) > len(records):
            raise BadDataException("Invalid message branch")
        path.append(current)
        current = by_id.get(current.parent_message_id) if current.parent_message_id is not None else None
    if not path:
        raise BadDataException("Message not found")
    return [Message.model_validate(message) for message in reversed(path)]


async def latest_branch_user_turn(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> MessageModel | None:
    """The active branch's latest user turn, which carries its branch-local state."""
    records = list(await session.scalars(select_owned_messages(user_id=user_id, chat_id=chat_id)))
    root = await session.scalar(
        select(ChatModel.active_root_id).where(ChatModel.id == chat_id, ChatModel.user_id == user_id)
    )
    by_id = {row.id: row for row in records}
    for message in reversed(active_branch(records, root)):
        if message.role == "user":
            return by_id[message.id]
    return None


async def nearest_user_ancestor(
    *, user_id: str, chat_id: uuid.UUID, parent_id: uuid.UUID | None, session: AsyncSession
) -> MessageModel | None:
    """A fork inherits state from its source ancestry, never from a sibling."""
    visited: set[uuid.UUID] = set()
    while parent_id is not None:
        if parent_id in visited:
            raise CodedException(409, "Invalid message ancestry")
        visited.add(parent_id)
        parent = await session.scalar(
            select_owned_messages(user_id=user_id, chat_id=chat_id).where(MessageModel.id == parent_id)
        )
        if parent is None:
            raise CodedException(409, "Source branch is unavailable")
        if parent.role == "user":
            return parent
        parent_id = parent.parent_message_id
    return None
