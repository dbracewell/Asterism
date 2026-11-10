"""Admin canvas policy and owner-scoped canvas reads (ADR-0063)."""

import uuid

from fastapi import APIRouter, Query, Response

from asterism.common.log import get_logger
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.files.schemas import UserFile
from asterism.domains.files.service import SOURCE_RESPONSE_HEADERS
from asterism.domains.user.dependencies import AdminUserDep, AuthedUserDep

from . import downloads, policy, service
from .branches import active_branch
from .exports import CanvasExportFormat, ExportedFile, content_disposition
from .schemas import (
    CanvasItemCreate,
    CanvasItemHistory,
    CanvasItemSummary,
    CanvasLibrarySave,
    CanvasPolicy,
    CanvasRestore,
    CanvasVersion,
    CanvasVersionCreate,
)

canvas_router = APIRouter(
    tags=["canvas"],
    responses={
        400: {"model": ErrorDetail},
        401: {"model": ErrorDetail},
        403: {"model": ErrorDetail},
        404: {"model": ErrorDetail},
        409: {"model": ErrorDetail},
    },
)
logger = get_logger("Canvas")


@canvas_router.get("/settings/app/canvas", operation_id="canvasPolicyGet")
async def get_policy(user: AdminUserDep, session: DBSessionDep) -> CanvasPolicy:
    return await policy.read_policy(session)


@canvas_router.put("/settings/app/canvas", operation_id="canvasPolicyUpdate")
async def put_policy(payload: CanvasPolicy, user: AdminUserDep, session: DBSessionDep) -> CanvasPolicy:
    result = await policy.write_policy(payload, session)
    logger.info(f"Canvas policy set to {result.enabled} by admin {user.id}")
    return result


@canvas_router.get("/chat/{chat_id}/canvas", operation_id="canvasItemGetMany")
async def list_items(chat_id: uuid.UUID, user: AuthedUserDep, session: DBSessionDep) -> list[CanvasItemSummary]:
    """Items visible on the chat's active branch, with their current versions."""
    branch = await active_branch(user.id, chat_id, session)
    return [service.summary(entry) for entry in await service.visible_items(user.id, chat_id, branch, session)]


@canvas_router.post("/chat/{chat_id}/canvas", operation_id="canvasItemCreate")
async def create_item(
    chat_id: uuid.UUID, payload: CanvasItemCreate, user: AuthedUserDep, session: DBSessionDep
) -> CanvasVersion:
    """Start a canvas item yourself; the agent sees it on its next turn."""
    branch = await active_branch(user.id, chat_id, session)
    await policy.require_canvas(user.id, chat_id, session)
    entry = await service.create_user_item(
        user.id,
        chat_id,
        branch,
        kind=payload.kind,
        title=payload.title,
        language=payload.language,
        content=payload.content,
        session=session,
    )
    return service.full_version(entry)


_BINARY = {
    200: {
        "description": "The exported file",
        "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
    }
}


def _download(file: ExportedFile) -> Response:
    return Response(
        content=file.content,
        media_type=file.media_type,
        headers={
            "Content-Disposition": content_disposition(file.filename),
            "Cache-Control": "private, no-store",
            **SOURCE_RESPONSE_HEADERS,
        },
    )


# Declared before /{item_id} routes: "export" is not an item id.
@canvas_router.get(
    "/chat/{chat_id}/canvas/export",
    operation_id="canvasExportZip",
    response_class=Response,
    responses=_BINARY,
)
async def export_zip(chat_id: uuid.UUID, user: AuthedUserDep, session: DBSessionDep) -> Response:
    """A ZIP of every item on the active branch, each at its current version."""
    return _download(await downloads.export_chat(user.id, chat_id, session))


@canvas_router.get("/chat/{chat_id}/canvas/{item_id}", operation_id="canvasItemGetOne")
async def get_item(
    chat_id: uuid.UUID, item_id: uuid.UUID, user: AuthedUserDep, session: DBSessionDep
) -> CanvasItemHistory:
    """The item's versions visible on the chat's active branch."""
    branch = await active_branch(user.id, chat_id, session)
    return service.history(await service.visible_item(user.id, chat_id, item_id, branch, session))


@canvas_router.get("/chat/{chat_id}/canvas/{item_id}/versions/{number}", operation_id="canvasVersionGetOne")
async def get_version(
    chat_id: uuid.UUID, item_id: uuid.UUID, number: int, user: AuthedUserDep, session: DBSessionDep
) -> CanvasVersion:
    branch = await active_branch(user.id, chat_id, session)
    return service.full_version(await service.visible_item(user.id, chat_id, item_id, branch, session), number)


@canvas_router.post("/chat/{chat_id}/canvas/{item_id}/versions", operation_id="canvasVersionCreate")
async def create_version(
    chat_id: uuid.UUID, item_id: uuid.UUID, payload: CanvasVersionCreate, user: AuthedUserDep, session: DBSessionDep
) -> CanvasVersion:
    """Save the user's edit as a new version; the agent sees it on its next turn."""
    branch = await active_branch(user.id, chat_id, session)
    await policy.require_canvas(user.id, chat_id, session)
    entry = await service.save_user_version(
        user.id,
        chat_id,
        item_id,
        branch,
        base_version=payload.base_version,
        title=payload.title,
        content=payload.content,
        session=session,
    )
    logger.info(f"User {user.id} saved canvas item {item_id} version {entry.current.number}")
    return service.full_version(entry)


@canvas_router.post("/chat/{chat_id}/canvas/{item_id}/versions/{number}/restore", operation_id="canvasVersionRestore")
async def restore_version(
    chat_id: uuid.UUID,
    item_id: uuid.UUID,
    number: int,
    payload: CanvasRestore,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> CanvasVersion:
    """Copy an earlier version into a new one; history is never rewritten."""
    branch = await active_branch(user.id, chat_id, session)
    await policy.require_canvas(user.id, chat_id, session)
    entry = await service.restore_version(
        user.id, chat_id, item_id, branch, number=number, base_version=payload.base_version, session=session
    )
    logger.info(f"User {user.id} restored canvas item {item_id} version {number} as {entry.current.number}")
    return service.full_version(entry)


@canvas_router.get(
    "/chat/{chat_id}/canvas/{item_id}/versions/{number}/export",
    operation_id="canvasVersionExport",
    response_class=Response,
    responses=_BINARY,
)
async def export_one(
    chat_id: uuid.UUID,
    item_id: uuid.UUID,
    number: int,
    user: AuthedUserDep,
    session: DBSessionDep,
    format: CanvasExportFormat = Query(),
) -> Response:
    """One version as a file: .md, .txt, its source extension, .html, DOCX or PDF."""
    return _download(await downloads.export_item_version(user.id, chat_id, item_id, number, format, session))


@canvas_router.post(
    "/chat/{chat_id}/canvas/{item_id}/versions/{number}/library", operation_id="canvasVersionSaveToLibrary"
)
async def save_to_library(
    chat_id: uuid.UUID,
    item_id: uuid.UUID,
    number: int,
    payload: CanvasLibrarySave,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> UserFile:
    """Save one version to the user's file library."""
    return await downloads.save_to_library(user.id, chat_id, item_id, number, payload.format, session)
