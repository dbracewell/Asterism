import uuid

from fastapi import APIRouter

from asterism.core.exceptions import ErrorDetail
from asterism.core.models import FolderModel, FolderModelList
from asterism.core.repositories import folder_repository
from asterism.core.services.dependencies import AuthedUserDep, DBSessionDep
from asterism.core.services.schemas import (
    GetFolderRequest,
    NewFolderRequest,
)

folder_router = APIRouter(
    prefix="/folders",
    tags=["folders"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@folder_router.post(
    "/",
    response_model=FolderModel,
    operation_id="folderCreate",
)
async def create_folder(
    payload: NewFolderRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> FolderModel:
    return await folder_repository.create_folder(
        user_id=user.id,
        payload=payload,
        session=db,
    )


@folder_router.get(
    "/",
    response_model=FolderModelList,
    operation_id="folderGetMany",
)
async def list_folders(
    user: AuthedUserDep,
    db: DBSessionDep,
) -> FolderModelList:
    return await folder_repository.list_folders(
        user.id,
        session=db,
    )


@folder_router.get(
    "/{folder_id}",
    response_model=FolderModel,
    operation_id="folderGetOne",
)
async def get_folder(
    folder_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
):
    return await folder_repository.get_folder(
        user_id=user.id,
        payload=GetFolderRequest(id=folder_id, include_children=False),
        session=db,
    )


@folder_router.delete(
    "/{folder_id}",
    response_model=FolderModel,
    operation_id="folderDelete",
)
async def delete_folder(
    folder_id: str,
    user: AuthedUserDep,
    db: DBSessionDep,
):
    return await folder_repository.delete_folder(
        user_id=user.id,
        folder_id=uuid.UUID(folder_id),
        session=db,
    )
