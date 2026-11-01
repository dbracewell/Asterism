"""Chat learning-mode selection; acceptance pins the selected mode's snapshot."""

import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException
from asterism.domains.agent.learning_inputs import HintLevel, LearningModeSnapshot
from asterism.domains.learning.catalog import recheck_pinned, require_mode

from .jobs import chat_jobs
from .model_selection import selection_info
from .models import ChatModel, MessageModel
from .queries import select_owned_chats, select_owned_messages
from .schemas import ChatInfo, ChatLearningModeUpdate, HintRequest, MessageStatus


def current_mode_snapshot(chat: ChatModel, hint_level: HintLevel = HintLevel.NONE) -> LearningModeSnapshot:
    """The live definition of the chat's current selection, for acceptance and regeneration."""
    return require_mode(chat.learning_mode).snapshot(hint_level)


def turn_hint_level(turn: MessageModel | None) -> HintLevel:
    """The branch hint level carried by a user turn; a branch starts at ``none``."""
    return turn.hint_level if turn is not None else HintLevel.NONE


def accept_hint_level(*, chat: ChatModel, previous: HintLevel, request: HintRequest | None) -> HintLevel:
    """The hint level a new turn carries: unchanged, explicitly raised, or reset.

    Only the chat's current mode can offer a level, levels only rise within a
    branch, and the answer needs an explicit confirmation.
    """
    if request is None:
        return previous
    if request.level == HintLevel.NONE:
        return HintLevel.NONE
    if request.reset:
        previous = HintLevel.NONE
    mode = require_mode(chat.learning_mode)
    if request.level not in mode.raisable_hint_levels:
        raise ConflictException(f"{mode.name} mode does not offer this hint level")
    if request.level.rank <= previous.rank:
        raise ConflictException("Hint level is already at or above this level; reload before sending")
    if request.level == HintLevel.ANSWER and not request.confirm_reveal:
        raise BadDataException("Showing the answer needs confirmation")
    return request.level


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
    """A pending branch turn keeps its pinned mode; otherwise use the chat's
    selection at the branch's hint level."""
    latest = await session.scalar(
        select_owned_messages(user_id=user_id, chat_id=chat_id)
        .where(MessageModel.id.in_(branch_ids), MessageModel.role == "user")
        .order_by(MessageModel.created_at.desc(), MessageModel.id.desc())
        .limit(1)
    )
    if latest is not None and latest.status == MessageStatus.PENDING:
        return accepted_mode_snapshot(latest)
    chat = await session.scalar(select_owned_chats(user_id=user_id).where(ChatModel.id == chat_id))
    if chat is None:
        raise NotFoundException("Chat not found")
    return current_mode_snapshot(chat, turn_hint_level(latest))


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
