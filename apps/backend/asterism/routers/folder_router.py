import uuid
from typing import cast

from fastapi import APIRouter, HTTPException, status
from starlette.status import HTTP_401_UNAUTHORIZED

from asterism.internal.db import DBSessionDep
from asterism.repositories.folder_repository import FolderRepository
from asterism.routers.base import AuthenticatedUserId
from asterism.routers.typedefs import ErrorDetail
from asterism.schemas.folders import (
    FolderListResponse,
    FolderResponse,
    NewFolderRequest,
)

folder_router = APIRouter(
    prefix="/api/folders",
    tags=["folders"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@folder_router.delete(
    "/{folder_id}",
    status_code=status.HTTP_201_CREATED,
    operation_id="deleteFolder",
    responses={
        200: {"model": str},
        401: {"model": ErrorDetail},
        400: {"model": ErrorDetail},
        500: {"model": ErrorDetail},
    },
)
async def delete_folder(
    folder_id: str,
    user_id: AuthenticatedUserId,
    session: DBSessionDep,
):
    repo = FolderRepository(session)
    response = await repo.delete_folder(user_id=user_id, folder_id=uuid.UUID(folder_id))
    match response:
        case "401":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized",
            )
        case "404":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Folder not found",
            )
        case "500":
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Folder not found",
            )
    return "success"


@folder_router.post(
    "/",
    status_code=status.HTTP_201_CREATED,
    operation_id="createFolder",
    responses={
        200: {"model": FolderResponse},
        401: {"model": ErrorDetail},
        400: {"model": ErrorDetail},
    },
)
async def create_folder(
    request: NewFolderRequest,
    user_id: AuthenticatedUserId,
    session: DBSessionDep,
) -> FolderResponse:
    repo = FolderRepository(session)
    return await repo.create_folder(user_id, request.title, request.parent_folder_id)


@folder_router.get(
    "/list",
    status_code=status.HTTP_200_OK,
    operation_id="listFolders",
    responses={
        200: {"model": FolderListResponse},
        401: {"model": ErrorDetail},
    },
)
async def list_folders(
    user_id: AuthenticatedUserId,
    session: DBSessionDep,
) -> FolderListResponse:
    repo = FolderRepository(session)
    return await repo.list_folders(user_id)
