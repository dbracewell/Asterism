"""Chat learning-mode selection; acceptance pins the selected mode's snapshot."""

import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException
from asterism.domains.agent.learning_inputs import HintLevel, LearningModeId, LearningModeSnapshot
from asterism.domains.learning.catalog import recheck_pinned, require_mode
from asterism.domains.prompt_templates.rubric_provenance import RubricSnapshot, RubricUse, resolve_rubric_use

from .jobs import chat_jobs
from .model_selection import selection_info
from .models import ChatModel, MessageModel
from .queries import select_owned_chats, select_owned_messages
from .schemas import ChatInfo, ChatLearningModeUpdate, HintRequest, MessageStatus


def current_mode_snapshot(chat: ChatModel, hint_level: HintLevel = HintLevel.NONE) -> LearningModeSnapshot:
    """The live definition of the chat's current selection, for acceptance and regeneration."""
    return require_mode(chat.learning_mode).snapshot(hint_level)


async def accept_rubric(
    *, user_id: str, chat: ChatModel, use: RubricUse | None, session: AsyncSession
) -> RubricSnapshot | None:
    """Pin a send's rubric; only modes that give rubric feedback take one (US-57.1)."""
    if use is None:
        return None
    if require_mode(chat.learning_mode).rubric_feedback is None:
        raise BadDataException("A rubric can only be attached in Draft feedback mode")
    return await resolve_rubric_use(user_id=user_id, use=use, session=session)


def turn_hint_level(turn: MessageModel | None) -> HintLevel:
    """The branch hint level carried by a user turn; a branch starts at ``none``."""
    return turn.hint_level if turn is not None else HintLevel.NONE


def accept_hint_level(*, chat: ChatModel, previous: HintLevel, request: HintRequest | None) -> HintLevel:
    """The hint level a new turn carries: unchanged, explicitly raised, or reset.

    Only the chat's current mode can offer a level, levels only rise within a
    branch, and the answer needs an explicit confirmation, plus a lock override
    while the chat's mode is locked.
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
    if request.level == HintLevel.ANSWER and chat.learning_mode_locked and not request.override_lock:
        raise ConflictException("Learning mode is locked; confirm the override to show the answer")
    return request.level


async def apply_class_policy(
    *, user_id: str, chat: ChatModel, hint_level: HintLevel, request: HintRequest | None, session: AsyncSession
) -> HintLevel:
    """Narrow a send to the class policy of its course project (US-60.4).

    A refused mode or an explicit reveal is a 409. A branch already at the
    answer keeps going one level below it, so earlier reveals don't block it.
    """
    from asterism.domains.courses.policy import course_mode_policy

    policy = await course_mode_policy(user_id=user_id, project_id=chat.project_id, session=session)
    if policy is None:
        return hint_level
    policy.require_mode(chat.learning_mode)
    if hint_level == HintLevel.ANSWER and not policy.answer_reveal:
        if request is not None and request.level == HintLevel.ANSWER:
            policy.require_level(HintLevel.ANSWER)
        return HintLevel.WORKED_EXAMPLE
    return hint_level


async def require_class_policy(
    *, user_id: str, chat: ChatModel, mode: LearningModeId, hint_level: HintLevel | None, session: AsyncSession
) -> None:
    """The live check before every run, including resume and regeneration."""
    from asterism.domains.courses.policy import course_mode_policy

    policy = await course_mode_policy(user_id=user_id, project_id=chat.project_id, session=session)
    if policy is not None:
        policy.require_mode(mode)
        policy.require_level(hint_level)


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


def next_lock_state(chat: ChatModel, payload: ChatLearningModeUpdate) -> bool:
    """The lock after this update; releasing a lock needs an explicit override."""
    locked = chat.learning_mode_locked if payload.locked is None else payload.locked
    if payload.learning_mode == LearningModeId.STANDARD:
        if payload.locked:
            raise BadDataException("Standard mode cannot be locked")
        locked = False
    if chat.learning_mode_locked and not locked and not payload.override_lock:
        raise ConflictException("Learning mode is locked; confirm the override to leave it")
    return locked


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
            await require_class_policy(
                user_id=user_id, chat=chat, mode=payload.learning_mode, hint_level=None, session=session
            )
            locked = next_lock_state(chat, payload)
            if chat.learning_mode != payload.learning_mode or chat.learning_mode_locked != locked:
                chat.learning_mode = payload.learning_mode
                chat.learning_mode_locked = locked
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
