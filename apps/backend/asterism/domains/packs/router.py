"""HTTP surface for team packs. Owner-scoped; foreign project IDs are 404."""

import uuid

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from .documents import PackManifest
from .export import export_pack
from .importer import import_pack
from .review import review_pack
from .schemas import (
    PackExportRequest,
    PackImportRequest,
    PackImportResult,
    PackReview,
    PackSource,
    StarterPackCatalog,
)
from .starters import STARTER_PACKS

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


team_packs_router = APIRouter(
    prefix="/team-packs",
    tags=["packs"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}, 409: {"model": ErrorDetail}},
)


@team_packs_router.get("/starters", response_model=StarterPackCatalog, operation_id="teamPackStarterGetMany")
async def list_starter_packs(user: AuthedUserDep) -> StarterPackCatalog:
    """The bundled packs. Installing one uses the same review and import."""
    return STARTER_PACKS


@team_packs_router.post("/review", response_model=PackReview, operation_id="teamPackReview")
async def create_pack_review(payload: PackSource, user: AuthedUserDep, db: DBSessionDep) -> PackReview:
    """Describe what a pack asks for. Nothing is stored or changed."""
    return await review_pack(user_id=user.id, source=payload.source, session=db)


@team_packs_router.post("/import", response_model=PackImportResult, operation_id="teamPackImport")
async def create_pack_import(payload: PackImportRequest, user: AuthedUserDep, db: DBSessionDep) -> PackImportResult:
    """Create the items the user decided on, or nothing if any check fails."""
    return await import_pack(user_id=user.id, payload=payload, session=db)
