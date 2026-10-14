import uuid

from fastapi import APIRouter

import asterism.domains.folders.service as folder_service
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import Folder, FolderList, GetFolderRequest, NewFolderRequest

folder_router = APIRouter(
    prefix="/folders",
    tags=["folders"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@folder_router.post(
    "/",
    response_model=Folder,
    operation_id="folderCreate",
)
async def create_folder(
    payload: NewFolderRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> Folder:
    return await folder_service.create_folder(
        user_id=user.id,
        payload=payload,
        session=db,
    )


@folder_router.get(
    "/",
    response_model=FolderList,
    operation_id="folderGetMany",
)
async def list_folders(
    user: AuthedUserDep,
    db: DBSessionDep,
) -> FolderList:
    return await folder_service.list_folders(
        user.id,
        session=db,
    )


@folder_router.get(
    "/{folder_id}",
    response_model=Folder,
    operation_id="folderGetOne",
)
async def get_folder(
    folder_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> Folder:
    return await folder_service.get_folder(
        user_id=user.id,
        payload=GetFolderRequest(id=folder_id, include_children=False),
        session=db,
    )


@folder_router.delete(
    "/{folder_id}",
    response_model=Folder,
    operation_id="folderDelete",
)
async def delete_folder(
    folder_id: str,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> Folder:
    return await folder_service.delete_folder(
        user_id=user.id,
        folder_id=uuid.UUID(folder_id),
        session=db,
    )
