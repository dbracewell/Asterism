"""Authenticated private rubric CRUD and the read-only bundled rubric catalog (US-57.1)."""

import uuid

from fastapi import APIRouter, Path, Query, Response

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import rubric_service as service
from .rubric_schemas import BundledRubricView, Rubric, RubricCatalog, RubricCreate, RubricPage, RubricUpdate
from .schemas import MAX_REVISION

rubrics_router = APIRouter(
    prefix="/rubrics",
    tags=["rubrics"],
    responses={
        400: {"model": ErrorDetail},
        401: {"model": ErrorDetail},
        404: {"model": ErrorDetail},
        409: {"model": ErrorDetail},
    },
)


# Static catalog routes must precede /{rubric_id}. The catalog has no write routes.
@rubrics_router.get("/bundled", operation_id="rubricBundledGetMany")
async def list_bundled(user: AuthedUserDep) -> RubricCatalog:
    return service.list_bundled_rubrics()


@rubrics_router.get("/bundled/{rubric_id}", operation_id="rubricBundledGetOne")
async def get_bundled(user: AuthedUserDep, rubric_id: str = Path(max_length=64)) -> BundledRubricView:
    return service.read_bundled_rubric(rubric_id)


@rubrics_router.get("/", operation_id="rubricGetMany")
async def list_rubrics(
    user: AuthedUserDep,
    session: DBSessionDep,
    query: str = Query(default="", max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> RubricPage:
    return await service.list_rubrics(user.id, session, query=query, page=page, page_size=page_size)


@rubrics_router.post("/", operation_id="rubricCreate", status_code=201)
async def create(payload: RubricCreate, user: AuthedUserDep, session: DBSessionDep) -> Rubric:
    return await service.create_rubric(user.id, payload, session)


@rubrics_router.get("/{rubric_id}", operation_id="rubricGetOne")
async def get_one(rubric_id: uuid.UUID, user: AuthedUserDep, session: DBSessionDep) -> Rubric:
    return await service.read_rubric(user.id, rubric_id, session)


@rubrics_router.put("/{rubric_id}", operation_id="rubricUpdate")
async def update(rubric_id: uuid.UUID, payload: RubricUpdate, user: AuthedUserDep, session: DBSessionDep) -> Rubric:
    return await service.update_rubric(user.id, rubric_id, payload, session)


@rubrics_router.delete("/{rubric_id}", operation_id="rubricDelete", status_code=204)
async def delete(
    rubric_id: uuid.UUID,
    user: AuthedUserDep,
    session: DBSessionDep,
    expected_revision: int = Query(ge=1, le=MAX_REVISION),
) -> Response:
    await service.delete_rubric(user.id, rubric_id, expected_revision, session)
    return Response(status_code=204)
