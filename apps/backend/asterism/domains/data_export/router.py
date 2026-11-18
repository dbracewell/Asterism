"""Download my data: request an archive, see its state, and download it."""

import time
import uuid

from fastapi import APIRouter, Query, status
from fastapi.responses import FileResponse

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import service
from .schemas import DataExport, DataExportLink, DataExportState

data_export_router = APIRouter(
    prefix="/data-export",
    tags=["data-export"],
    responses={401: {"model": ErrorDetail}, 404: {"model": ErrorDetail}},
)


@data_export_router.get("", response_model=DataExportState, operation_id="dataExportGet")
async def read_export(user: AuthedUserDep, db: DBSessionDep) -> DataExportState:
    """Your latest archive, or none."""
    return DataExportState(export=await service.latest_export(user.id, db))


@data_export_router.post(
    "",
    response_model=DataExport,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="dataExportCreate",
    responses={409: {"model": ErrorDetail}},
)
async def create_export(user: AuthedUserDep, db: DBSessionDep) -> DataExport:
    """Prepare a new archive in the background, replacing the last one."""
    return await service.request_export(user.id, db)


@data_export_router.post("/link", response_model=DataExportLink, operation_id="dataExportLinkCreate")
async def create_link(user: AuthedUserDep, db: DBSessionDep) -> DataExportLink:
    """A download link for the ready archive, valid for a few minutes."""
    return await service.download_link(user.id, db)


@data_export_router.get(
    "/{export_id}/archive",
    response_class=FileResponse,
    operation_id="dataExportDownload",
    include_in_schema=False,
)
async def download(export_id: uuid.UUID, db: DBSessionDep, ticket: str = Query(max_length=200)) -> FileResponse:
    """The archive itself. The ticket authenticates, so the browser can download it directly."""
    path = await service.archive_for_ticket(export_id, ticket, db)
    name = f"asterism-data-{time.strftime('%Y-%m-%d', time.gmtime(path.stat().st_mtime))}.zip"
    return FileResponse(
        path,
        media_type="application/zip",
        filename=name,
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
