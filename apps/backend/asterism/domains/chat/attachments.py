"""Validate stable source IDs and persist local references in the message transaction."""

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
