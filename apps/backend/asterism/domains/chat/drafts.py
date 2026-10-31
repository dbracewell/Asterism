"""Draft references never grant runtime access; sources remain in the library."""

import asyncio
import time
import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.domains.files.service import validate_owned_file_ids

from .draft_models import ChatDraftFileModel, ChatDraftModel
from .model_selection import require_chat_model
from .models import ChatModel
from .schemas import ChatDraft, ChatDraftCreate, ChatDraftFiles, ChatDraftModelUpdate

DRAFT_TTL_SECONDS = 24 * 60 * 60


async def cleanup_expired_drafts(*, user_id: str, session: AsyncSession) -> None:
    """Lazy owner-scoped cleanup; caller owns transaction. Never delete source files."""
    ids = select(ChatDraftModel.id).where(
        ChatDraftModel.user_id == user_id,
        ChatDraftModel.expires_at <= int(time.time()),
    )
    await session.execute(delete(ChatDraftFileModel).where(ChatDraftFileModel.draft_id.in_(ids)))
    await session.execute(delete(ChatDraftModel).where(ChatDraftModel.id.in_(ids)))


async def owned_draft(*, user_id: str, draft_id: uuid.UUID, session: AsyncSession) -> ChatDraftModel:
    draft = await session.scalar(
        update(ChatDraftModel)
        .where(
            ChatDraftModel.id == draft_id,
            ChatDraftModel.user_id == user_id,
            ChatDraftModel.expires_at > int(time.time()),
        )
        .values(expires_at=ChatDraftModel.expires_at)
        .returning(ChatDraftModel)
        .execution_options(populate_existing=True),
    )
    if draft is None:
        raise NotFoundException("Draft not found or expired")
    return draft


async def draft_response(*, draft: ChatDraftModel, session: AsyncSession) -> ChatDraft:
    ids = list(
        await session.scalars(
            select(ChatDraftFileModel.file_id)
            .where(
                ChatDraftFileModel.draft_id == draft.id,
                ChatDraftFileModel.user_id == draft.user_id,
            )
            .order_by(ChatDraftFileModel.file_id),
        ),
    )
    return ChatDraft(
        id=draft.id,
        model_id=draft.model_id,
        chat_id=draft.chat_id,
        expires_at=draft.expires_at,
        file_ids=sorted(draft.selected_file_ids, key=str),
        unavailable_file_ids=sorted(set(draft.selected_file_ids) - set(ids), key=str),
    )


async def create_draft(*, user_id: str, payload: ChatDraftCreate, session: AsyncSession) -> ChatDraft:
    try:
        await cleanup_expired_drafts(user_id=user_id, session=session)
        if payload.chat_id is not None:
            if not await session.scalar(
                select(ChatModel.id).where(
                    ChatModel.id == payload.chat_id,
                    ChatModel.user_id == user_id,
                ),
            ):
                raise NotFoundException("Chat not found")
        if payload.model_id is not None:
            if payload.chat_id is not None:
                raise BadDataException("Change an existing chat's model through its selection endpoint")
            await require_chat_model(payload.model_id, user_id, session)
        draft = ChatDraftModel(
            user_id=user_id,
            chat_id=payload.chat_id,
            model_id=payload.model_id,
            expires_at=int(time.time()) + DRAFT_TTL_SECONDS,
        )
        session.add(draft)
        await session.flush()
        result = await draft_response(draft=draft, session=session)
        await session.commit()
        return result
    except (Exception, asyncio.CancelledError):
        await session.rollback()
        raise


async def change_draft_files(
    *,
    user_id: str,
    draft_id: uuid.UUID,
    payload: ChatDraftFiles,
    remove: bool,
    session: AsyncSession,
) -> ChatDraft:
    try:
        draft = await owned_draft(user_id=user_id, draft_id=draft_id, session=session)
        if len(payload.file_ids) != len(set(payload.file_ids)):
            raise BadDataException("Attached files must not be repeated")
        if remove:
            draft.selected_file_ids = [
                file_id for file_id in draft.selected_file_ids if file_id not in payload.file_ids
            ]
            await session.execute(
                delete(ChatDraftFileModel).where(
                    ChatDraftFileModel.draft_id == draft_id,
                    ChatDraftFileModel.user_id == user_id,
                    ChatDraftFileModel.file_id.in_(payload.file_ids),
                ),
            )
        else:
            await validate_owned_file_ids(user_id=user_id, file_ids=payload.file_ids, session=session)
            current = await draft_response(draft=draft, session=session)
            existing = set(current.file_ids)
            live_ids = existing - set(current.unavailable_file_ids)
            if len(existing | set(payload.file_ids)) > 100:
                raise BadDataException("A draft may contain at most 100 files")
            draft.selected_file_ids = sorted(existing | set(payload.file_ids), key=str)
            session.add_all(
                [
                    ChatDraftFileModel(user_id=user_id, draft_id=draft_id, file_id=file_id)
                    for file_id in payload.file_ids
                    if file_id not in live_ids
                ],
            )
        await session.flush()
        result = await draft_response(draft=draft, session=session)
        await session.commit()
        return result
    except (Exception, asyncio.CancelledError):
        await session.rollback()
        raise


async def discard_draft(*, user_id: str, draft_id: uuid.UUID, session: AsyncSession) -> ChatDraft:
    try:
        draft = await owned_draft(user_id=user_id, draft_id=draft_id, session=session)
        result = await draft_response(draft=draft, session=session)
        await consume_draft(user_id=user_id, draft_id=draft_id, session=session)
        await session.commit()
        return result
    except (Exception, asyncio.CancelledError):
        await session.rollback()
        raise


async def read_draft_file_ids(
    *,
    user_id: str,
    draft_id: uuid.UUID | None,
    chat_id: uuid.UUID | None,
    session: AsyncSession,
) -> list[uuid.UUID]:
    if draft_id is None:
        return []
    draft = await owned_draft(user_id=user_id, draft_id=draft_id, session=session)
    if draft.chat_id != chat_id:
        raise BadDataException("Draft belongs to a different chat")
    current = await draft_response(draft=draft, session=session)
    if current.unavailable_file_ids:
        raise BadDataException("One or more staged attachments are unavailable; remove them before sending")
    return current.file_ids


async def consume_draft(*, user_id: str, draft_id: uuid.UUID | None, session: AsyncSession) -> None:
    if draft_id is None:
        return
    await session.execute(
        delete(ChatDraftFileModel).where(
            ChatDraftFileModel.draft_id == draft_id,
            ChatDraftFileModel.user_id == user_id,
        ),
    )
    await session.execute(
        delete(ChatDraftModel).where(ChatDraftModel.id == draft_id, ChatDraftModel.user_id == user_id),
    )


async def get_draft(*, user_id: str, draft_id: uuid.UUID, session: AsyncSession) -> ChatDraft:
    try:
        draft = await owned_draft(user_id=user_id, draft_id=draft_id, session=session)
        result = await draft_response(draft=draft, session=session)
        await session.commit()
        return result
    except (Exception, asyncio.CancelledError):
        await session.rollback()
        raise


async def change_draft_model(
    *,
    user_id: str,
    draft_id: uuid.UUID,
    payload: ChatDraftModelUpdate,
    session: AsyncSession,
) -> ChatDraft:
    from asterism.core.exceptions import CodedException

    try:
        draft = await owned_draft(user_id=user_id, draft_id=draft_id, session=session)
        if draft.chat_id is not None:
            raise BadDataException("Change the existing chat's model through its selection endpoint")
        if draft.model_id != payload.expected_model_id:
            raise CodedException(409, "Draft model selection changed; reload and retry")
        if payload.model_id is not None:
            await require_chat_model(payload.model_id, user_id, session)
        draft.model_id = payload.model_id
        result = await draft_response(draft=draft, session=session)
        await session.commit()
        return result
    except BaseException:
        await session.rollback()
        raise
