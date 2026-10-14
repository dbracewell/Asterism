"""Validate stable source IDs and persist local references in the message transaction."""

import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.queries import select_owned_files

from .models import ChatFileModel
from .schemas import MessageFileReference


async def resolve_file_references(
    *,
    user_id: str,
    file_ids: list[uuid.UUID],
    session: AsyncSession,
) -> list[MessageFileReference]:
    if len(file_ids) != len(set(file_ids)):
        raise BadDataException("Attached files must not be repeated")
    records = await session.scalars(select_owned_files(user_id=user_id).where(UserFileModel.id.in_(file_ids)))
    found = {file.id: file for file in records}
    if any(file_id not in found for file_id in file_ids):
        raise BadDataException("One or more attached files are unavailable")
    return [
        MessageFileReference(
            file_id=file.id,
            filename=file.filename,
            name=file.original_name,
            mime_type=file.mime_type,
            size=file.size,
            kind=file.kind,
            status=file.content_status,
        )
        for file_id in file_ids
        for file in [found[file_id]]
    ]


async def bind_message_files(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    files: list[MessageFileReference],
    session: AsyncSession,
) -> None:
    ids = [file.file_id for file in files]
    existing = set(
        await session.scalars(
            select(ChatFileModel.file_id).where(
                ChatFileModel.chat_id == chat_id,
                ChatFileModel.user_id == user_id,
                ChatFileModel.file_id.in_(ids),
            ),
        ),
    )
    session.add_all(
        [ChatFileModel(chat_id=chat_id, user_id=user_id, file_id=file_id)
         for file_id in ids if file_id not in existing],
    )


async def remove_chat_file(*, user_id: str, chat_id: uuid.UUID, file_id: uuid.UUID,
                           session: AsyncSession):
    from sqlalchemy import delete, update

    from asterism.core.exceptions import NotFoundException

    from .jobs import chat_jobs
    from .models import ChatModel
    from .scope import resolve_chat_file_scope

    try:
        if not await session.scalar(select(ChatModel.id).where(ChatModel.id == chat_id, ChatModel.user_id == user_id)):
            raise NotFoundException("Chat not found")
        with chat_jobs.guard_idle_change(chat_id):
            await session.execute(update(ChatModel).where(ChatModel.id == chat_id, ChatModel.user_id == user_id)
                                  .values(updated_at=ChatModel.updated_at))
            await session.execute(delete(ChatFileModel).where(
                ChatFileModel.chat_id == chat_id, ChatFileModel.user_id == user_id, ChatFileModel.file_id == file_id,
            ))
            result = await resolve_chat_file_scope(user_id=user_id, chat_id=chat_id, session=session)
            await session.commit()
            return result
    except (Exception, asyncio.CancelledError):
        await session.rollback()
        raise
