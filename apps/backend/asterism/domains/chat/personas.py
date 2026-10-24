"""Chat/persona composition: explicit override or the owner's current default."""

import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import ConflictException, NotFoundException
from asterism.domains.agent.prompts import PersonaSnapshot
from asterism.domains.user.models import UserModel
from asterism.domains.user.personas import require_owned_persona, require_persona_access

from .jobs import chat_jobs
from .model_selection import selection_info
from .models import ChatModel, MessageModel
from .queries import select_owned_chats, select_owned_messages
from .schemas import ChatInfo, ChatPersonaUpdate, MessageStatus


async def resolve_persona_snapshot(
    *,
    user_id: str,
    persona_id: uuid.UUID | None,
    session: AsyncSession,
) -> PersonaSnapshot:
    if persona_id is None:
        owner = await session.get(UserModel, user_id, populate_existing=True)
        if owner is None:
            raise NotFoundException("User not found")
        persona_id = owner.default_persona_id
    row = await require_owned_persona(user_id=user_id, persona_id=persona_id, session=session)
    return PersonaSnapshot.model_validate(row)


async def read_chat_persona_snapshot(*, user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> PersonaSnapshot:
    chat = await session.scalar(select_owned_chats(user_id=user_id).where(ChatModel.id == chat_id))
    if chat is None:
        raise NotFoundException("Chat not found")
    return await resolve_persona_snapshot(user_id=user_id, persona_id=chat.persona_id, session=session)


async def change_chat_persona(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    payload: ChatPersonaUpdate,
    session: AsyncSession,
):
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
            if chat.persona_revision != payload.expected_persona_revision:
                raise ConflictException("Chat persona selection changed; reload and retry")
            await resolve_persona_snapshot(user_id=user_id, persona_id=payload.persona_id, session=session)
            if chat.persona_id != payload.persona_id:
                chat.persona_id = payload.persona_id
                chat.persona_revision += 1
            await session.flush()
            result = await selection_info(chat, session)
            await session.commit()
            return result
        except BaseException:
            await session.rollback()
            raise


async def validate_persona_access(*, user_id: str, persona_id: uuid.UUID) -> None:
    """Live access check used by the named Agent execution assembly reader."""
    from asterism.db.database import get_async_db_session

    async with get_async_db_session() as db:
        await require_persona_access(user_id=user_id, persona_id=persona_id, session=db)


async def read_pending_or_current_persona(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    branch_ids: tuple[uuid.UUID, ...],
    session: AsyncSession,
) -> PersonaSnapshot:
    pending = await session.scalar(
        select_owned_messages(user_id=user_id, chat_id=chat_id)
        .where(
            MessageModel.id.in_(branch_ids), MessageModel.role == "user", MessageModel.status == MessageStatus.PENDING
        )
        .order_by(MessageModel.created_at.desc(), MessageModel.id.desc())
        .limit(1)
    )
    if pending is not None:
        if pending.pending_execution_record is not None:
            execution = pending.pending_execution_record.execution
            layer = next(
                (layer for layer in pending.pending_execution_record.prompt.layers if layer.kind == "profile"), None
            )
            if layer is None:
                raise ConflictException("Recorded persona input is unavailable; regenerate")
            await require_persona_access(user_id=user_id, persona_id=execution.persona.id, session=session)
            return PersonaSnapshot(**execution.persona.model_dump(), user_md=layer.text)
        if pending.accepted_persona is None:
            raise ConflictException("Accepted persona input is unavailable; regenerate")
        try:
            await require_persona_access(user_id=user_id, persona_id=pending.accepted_persona.id, session=session)
        except NotFoundException as error:
            raise ConflictException("Accepted persona is unavailable; regenerate") from error
        return pending.accepted_persona
    return await read_chat_persona_snapshot(user_id=user_id, chat_id=chat_id, session=session)


async def describe_pending_persona(
    *,
    user_id: str,
    pending: MessageModel,
    info: ChatInfo,
    session: AsyncSession,
) -> None:
    if pending.pending_execution is not None:
        info.pending_persona = pending.pending_execution.persona
    elif pending.accepted_persona is not None:
        info.pending_persona = pending.accepted_persona.identity
    if pending.pending_execution is None and pending.role == "user":
        try:
            if pending.accepted_persona is None:
                raise NotFoundException("Accepted persona input is unavailable")
            await require_persona_access(user_id=user_id, persona_id=pending.accepted_persona.id, session=session)
        except NotFoundException:
            info.resume_error = "Accepted persona is unavailable; regenerate with an available persona"
