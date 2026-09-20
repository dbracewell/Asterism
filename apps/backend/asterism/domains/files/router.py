from typing import Annotated

from fastapi import APIRouter, File, Query, UploadFile, status
from fastapi.responses import FileResponse

import asterism.domains.files.service as file_service
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import UserFile, UserFileList

file_router = APIRouter(
    tags=["files"],
    prefix="/files",
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@file_router.post(
    "/",
    response_model=UserFileList,
    status_code=status.HTTP_201_CREATED,
    operation_id="fileUpload",
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}},
)
async def upload_files(
    user: AuthedUserDep,
    db: DBSessionDep,
    files: Annotated[list[UploadFile], File(description="Files to upload")],
) -> UserFileList:
    return await file_service.upload_files(user_id=user.id, uploads=files, session=db)


@file_router.get(
    "/",
    response_model=UserFileList,
    operation_id="fileGetMany",
    responses={401: {"model": ErrorDetail}},
)
async def list_files(
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> UserFileList:
    return await file_service.list_user_files(
        user_id=user.id, session=db, page=page, page_size=page_size
    )


@file_router.delete(
    "/{filename}",
    response_model=UserFile,
    operation_id="fileDelete",
    responses={401: {"model": ErrorDetail}, 404: {"model": ErrorDetail}},
)
async def delete_file(
    filename: str, user: AuthedUserDep, db: DBSessionDep
) -> UserFile:
    return await file_service.delete_user_file(
        user_id=user.id, filename=filename, session=db
    )


@file_router.get(
    "/{filename}",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    operation_id="getFile",
    responses={
        200: {
            "description": "Returns the user's file",
            "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
        },
        401: {"model": ErrorDetail},
        400: {"model": ErrorDetail},
        404: {"model": ErrorDetail},
    },
)
async def get_file(user: AuthedUserDep, filename: str):
    return file_service.get_user_file(user_id=user.id, filename=filename)
