"""Chat file routes: the chat's file scope, file details, passages, previews and downloads."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Path
from fastapi.responses import FileResponse

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.files.schemas import FilePreview, UserFile
from asterism.domains.user.dependencies import AuthedUserDep

from ..citation_schemas import ChatFilePassage
from ..schemas import (
    ChatFileScope,
)

router = APIRouter()


@router.get("/{chat_id}/files/context", response_model=ChatFileScope, operation_id="chatFileGetScope")
async def get_file_scope(chat_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> ChatFileScope:
    from ..scope import resolve_chat_file_scope

    return await resolve_chat_file_scope(user_id=user.id, chat_id=chat_id, session=db)


@router.get("/{chat_id}/files/{file_id}/info", response_model=UserFile, operation_id="chatFileGetInfo")
async def get_chat_file_info(chat_id: uuid.UUID, file_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> UserFile:
    from asterism.domains.files.service import get_file_info_by_id

    from ..scope import require_chat_file

    await require_chat_file(user_id=user.id, chat_id=chat_id, file_id=file_id, session=db)
    return await get_file_info_by_id(user_id=user.id, file_id=file_id, session=db)


@router.get(
    "/{chat_id}/files/{file_id}/passages/{chunk_id}",
    response_model=ChatFilePassage,
    operation_id="chatFileGetPassage",
    responses={404: {"model": ErrorDetail}},
)
async def get_chat_file_passage(
    chat_id: uuid.UUID,
    file_id: uuid.UUID,
    chunk_id: Annotated[str, Path(min_length=1, max_length=200)],
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatFilePassage:
    """One cited passage of a scoped file, with its place in the file (US-90.4)."""
    from asterism.domains.knowledge.vector_store import vector_store

    from ..passages import read_scoped_passage

    return await read_scoped_passage(
        user_id=user.id, chat_id=chat_id, file_id=file_id, chunk_id=chunk_id, vectors=vector_store, session=db
    )


@router.get("/{chat_id}/files/{file_id}/preview", response_model=FilePreview, operation_id="chatFileGetPreview")
async def get_chat_file_preview(
    chat_id: uuid.UUID, file_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> FilePreview:
    """Text excerpt and structure counts of a scoped file, for document cards (US-56.5)."""
    from asterism.domains.files.preview import build_file_preview

    from ..scope import require_chat_file

    await require_chat_file(user_id=user.id, chat_id=chat_id, file_id=file_id, session=db)
    return await build_file_preview(user_id=user.id, file_id=file_id, session=db)


@router.get(
    "/{chat_id}/files/{file_id}",
    response_class=FileResponse,
    operation_id="chatFileDownload",
    responses={
        200: {
            "description": "Authorized original source download",
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}},
            },
        },
    },
)
async def download_chat_file(chat_id: uuid.UUID, file_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep):
    from asterism.domains.files.service import download_file_by_id

    from ..scope import require_chat_file

    await require_chat_file(user_id=user.id, chat_id=chat_id, file_id=file_id, session=db)
    return await download_file_by_id(user_id=user.id, file_id=file_id, session=db)


@router.delete(
    "/{chat_id}/files/{file_id}",
    response_model=ChatFileScope,
    operation_id="chatFileRemove",
    responses={409: {"model": ErrorDetail}},
)
async def remove_chat_file(
    chat_id: uuid.UUID,
    file_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatFileScope:
    from ..attachments import remove_chat_file

    return await remove_chat_file(user_id=user.id, chat_id=chat_id, file_id=file_id, session=db)
