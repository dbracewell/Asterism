"""Read one recorded run on any branch (US-54.6, run diff).

A run is a user turn plus the chain of assistant steps that answers it. Given
any message in the run (the user turn, or a step on a sibling branch such as a
fork or a regeneration), the steps are its ancestors back to the user turn and
then its own active chain until the next user turn. Nothing is recomputed.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import NotFoundException

from .models import MessageModel
from .queries import select_owned_messages
from .schemas import Message, RecordedRun


def run_through(records: list[MessageModel], message_id: uuid.UUID) -> tuple[MessageModel, list[MessageModel]]:
    """The user turn and assistant steps of the run that ``message_id`` belongs to."""
    by_id = {record.id: record for record in records}
    current = by_id.get(message_id)
    if current is None:
        raise NotFoundException("Message not found")
    before: list[MessageModel] = []
    while current.role != "user":
        before.append(current)
        parent = by_id.get(current.parent_message_id) if current.parent_message_id else None
        if parent is None or len(before) > len(records):
            raise NotFoundException("Run not found")
        current = parent
    request = current
    steps = list(reversed(before))
    tail = steps[-1] if steps else request
    following = by_id.get(tail.active_child_id) if tail.active_child_id else None
    while following is not None and following.role == "assistant" and len(steps) <= len(records):
        steps.append(following)
        following = by_id.get(following.active_child_id) if following.active_child_id else None
    return request, steps


async def read_run(*, user_id: str, chat_id: uuid.UUID, message_id: uuid.UUID, session: AsyncSession) -> RecordedRun:
    records = list(await session.scalars(select_owned_messages(user_id=user_id, chat_id=chat_id)))
    request, steps = run_through(records, message_id)
    return RecordedRun(
        request=Message.model_validate(request),
        steps=[Message.model_validate(step) for step in steps],
    )
