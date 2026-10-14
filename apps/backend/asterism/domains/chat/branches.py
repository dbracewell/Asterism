"""One deterministic branch traversal for chat presentation and file provenance."""

import uuid
from collections.abc import Sequence

from asterism.core.exceptions import BadDataException

from .models import MessageModel
from .schemas import Message


def active_branch(records: Sequence[MessageModel]) -> list[Message]:
    by_id = {message.id: message for message in records}
    children: dict[uuid.UUID | None, list[MessageModel]] = {}
    for message in records:
        children.setdefault(message.parent_message_id, []).append(message)
    for siblings in children.values():
        siblings.sort(key=lambda message: (message.created_at, str(message.id)))
    roots = children.get(None, [])
    if not roots:
        return []
    current = roots[0]
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
