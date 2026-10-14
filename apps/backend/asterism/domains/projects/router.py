import uuid

from fastapi import APIRouter, Query, status

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import service
from .schemas import Project, ProjectCreate, ProjectList, ProjectUpdate
from .service import ProjectSort

project_router = APIRouter(
    prefix="/projects",
    tags=["projects"],
    responses={401: {"model": ErrorDetail}, 404: {"model": ErrorDetail}},
)


@project_router.post(
    "/",
    response_model=Project,
    status_code=status.HTTP_201_CREATED,
    operation_id="projectCreate",
    responses={409: {"model": ErrorDetail}},
)
async def create_project(payload: ProjectCreate, user: AuthedUserDep, db: DBSessionDep) -> Project:
    return await service.create_project(user_id=user.id, payload=payload, session=db)


@project_router.get("/", response_model=ProjectList, operation_id="projectGetMany")
async def list_projects(
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    sort_by: ProjectSort = Query(default="name"),
    query: str | None = Query(default=None, max_length=10_000, description="Literal search of name and description"),
) -> ProjectList:
    return await service.list_projects(
        user_id=user.id,
        session=db,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        query=query,
    )


@project_router.get("/{project_id}", response_model=Project, operation_id="projectGetOne")
async def get_project(project_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> Project:
    return await service.get_project(user_id=user.id, project_id=project_id, session=db)


@project_router.patch(
    "/{project_id}",
    response_model=Project,
    operation_id="projectUpdate",
    responses={409: {"model": ErrorDetail}},
)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> Project:
    return await service.update_project(user_id=user.id, project_id=project_id, payload=payload, session=db)


@project_router.delete(
    "/{project_id}",
    response_model=Project,
    operation_id="projectDelete",
    responses={409: {"model": ErrorDetail}},
)
async def delete_project(
    project_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    expected_context_revision: int = Query(ge=1, description="Context revision from the last project read"),
) -> Project:
    return await service.delete_project(
        user_id=user.id,
        project_id=project_id,
        expected_context_revision=expected_context_revision,
        session=db,
    )
