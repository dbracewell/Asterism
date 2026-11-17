"""About you for chat turns: pinned on acceptance, replayed from the record (ADR-0066)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import ConflictException
from asterism.domains.agent.prompts import AboutSnapshot
from asterism.domains.user.about import read_about_snapshot

from .models import MessageModel
from .queries import select_owned_messages
from .schemas import MessageStatus


async def read_pending_or_current_about(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    branch_ids: tuple[uuid.UUID, ...],
    session: AsyncSession,
) -> AboutSnapshot:
    """The About you text a pending turn was accepted with, else the user's current text."""
    pending = await session.scalar(
        select_owned_messages(user_id=user_id, chat_id=chat_id)
        .where(
            MessageModel.id.in_(branch_ids), MessageModel.role == "user", MessageModel.status == MessageStatus.PENDING
        )
        .order_by(MessageModel.created_at.desc(), MessageModel.id.desc())
        .limit(1)
    )
    if pending is None:
        return await read_about_snapshot(user_id=user_id, session=session)
    record = pending.pending_execution_record
    if record is not None:
        layer = next((layer for layer in record.prompt.layers if layer.kind == "profile"), None)
        return AboutSnapshot(revision=record.execution.about.revision, text=layer.text if layer else "")
    if pending.accepted_about is None:
        raise ConflictException("Accepted About you input is unavailable; regenerate")
    return pending.accepted_about
