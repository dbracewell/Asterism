"""Chat learning-mode selection; acceptance pins the selected mode's snapshot."""

import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import ConflictException, NotFoundException
from asterism.domains.agent.learning_inputs import LearningModeSnapshot
from asterism.domains.learning.catalog import recheck_pinned, require_mode

from .jobs import chat_jobs
from .model_selection import selection_info
from .models import ChatModel, MessageModel
from .queries import select_owned_chats, select_owned_messages
from .schemas import ChatInfo, ChatLearningModeUpdate, MessageStatus


def current_mode_snapshot(chat: ChatModel) -> LearningModeSnapshot:
    """The live definition of the chat's current selection, for acceptance and regeneration."""
    return require_mode(chat.learning_mode).snapshot()


def accepted_mode_snapshot(message: MessageModel) -> LearningModeSnapshot:
    """A turn's pinned mode for first execution; the mode must still be offered."""
    snapshot = message.accepted_learning_mode
    if snapshot is None:
        raise ConflictException("Accepted learning mode is unavailable; regenerate")
    recheck_pinned(snapshot)
    return snapshot


async def read_pending_or_current_mode(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    branch_ids: tuple[uuid.UUID, ...],
    session: AsyncSession,
) -> LearningModeSnapshot:
    """A pending branch turn keeps its pinned mode; otherwise use the chat's selection."""
    pending = await session.scalar(
        select_owned_messages(user_id=user_id, chat_id=chat_id)
        .where(
            MessageModel.id.in_(branch_ids), MessageModel.role == "user", MessageModel.status == MessageStatus.PENDING
        )
        .order_by(MessageModel.created_at.desc(), MessageModel.id.desc())
        .limit(1)
    )
    if pending is not None:
        return accepted_mode_snapshot(pending)
    chat = await session.scalar(select_owned_chats(user_id=user_id).where(ChatModel.id == chat_id))
    if chat is None:
        raise NotFoundException("Chat not found")
    return current_mode_snapshot(chat)


async def change_chat_learning_mode(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    payload: ChatLearningModeUpdate,
    session: AsyncSession,
) -> ChatInfo:
    if await session.scalar(select_owned_chats(user_id=user_id).where(ChatModel.id == chat_id)) is None:
        raise NotFoundException("Chat not found")
    with chat_jobs.guard_idle_change(chat_id):
        try:
            chat = await session.scalar(
                update(ChatModel)
                .where(ChatModel.id == chat_id, ChatModel.user_id == user_id)
                .values(updated_at=ChatModel.updated_at)
                .returning(ChatModel)
                .execution_options(populate_existing=True)
            )
            if chat is None:
                raise NotFoundException("Chat not found")
            if chat.learning_mode_revision != payload.expected_learning_mode_revision:
                raise ConflictException("Chat learning mode changed; reload and retry")
            require_mode(payload.learning_mode)
            if chat.learning_mode != payload.learning_mode:
                chat.learning_mode = payload.learning_mode
                chat.learning_mode_revision += 1
            await session.flush()
            result = await selection_info(chat, session)
            await session.commit()
            return result
        except BaseException:
            await session.rollback()
            raise


def describe_pending_learning_mode(*, pending: MessageModel, info: ChatInfo) -> None:
    info.pending_learning_mode = pending.learning_mode
