"""HTTP surface for team packs. Owner-scoped; foreign project IDs are 404."""

import uuid

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from .documents import PackManifest
from .export import export_pack
from .schemas import PackExportRequest

packs_router = APIRouter(
    prefix="/projects/{project_id}/pack-export",
    tags=["packs"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}, 404: {"model": ErrorDetail}},
)


@packs_router.post("", response_model=PackManifest, operation_id="projectPackExport")
async def create_pack_export(
    project_id: uuid.UUID, payload: PackExportRequest, user: AuthedUserDep, db: DBSessionDep
) -> PackManifest:
    """Build a pack file from the chosen items. Nothing is stored or changed."""
    return await export_pack(user_id=user.id, project_id=project_id, payload=payload, session=db)
