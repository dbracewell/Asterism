from typing import Annotated, Literal

from fastapi import APIRouter, File, Query, UploadFile, status
from fastapi.responses import FileResponse

import asterism.domains.files.service as file_service
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.knowledge_base.schemas import FileKnowledgeArtifact
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import FileCaptionEdit, UserFile, UserFileList

file_router = APIRouter(
    tags=["files"],
    prefix="/files",
    responses={
        400: {"model": ErrorDetail, "description": "Bad Request"},
        401: {"model": ErrorDetail, "description": "Unauthorized"},
        403: {"model": ErrorDetail, "description": "Forbidden"},
        404: {"description": "Not found", "model": ErrorDetail},
    },
)


@file_router.post(
    "/",
    response_model=UserFileList,
    status_code=status.HTTP_201_CREATED,
    operation_id="fileUpload",
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
    status_code=status.HTTP_200_OK,
    operation_id="fileGetMany",
)
async def list_files(
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    sort_by: Literal["name", "kind", "date", "size"] = Query(default="name", pattern="^(name|kind|date|size)$"),
    query: str | None = Query(default=None, description="Search query to filter files by name"),
) -> UserFileList:
    return await file_service.list_user_files(
        user_id=user.id,
        session=db,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        query=query,
    )


@file_router.delete(
    "/",
    response_model=UserFileList,
    status_code=status.HTTP_200_OK,
    operation_id="fileDeleteMany",
)
async def delete_man_files(
    user: AuthedUserDep,
    filenames: list[str],
    session: DBSessionDep,
) -> UserFileList:
    return await file_service.delete_user_files(
        user_id=user.id,
        filenames=filenames,
        session=session,
    )


@file_router.get(
    "/info/{filename}",
    response_model=UserFile,
    status_code=status.HTTP_200_OK,
    operation_id="fileGetFileInfo",
)
async def get_file_info(
    user: AuthedUserDep,
    filename: str,
    session: DBSessionDep,
) -> UserFile:
    return await file_service.get_user_file_info(
        user_id=user.id,
        filename=filename,
        session=session,
    )


@file_router.delete(
    "/{filename}",
    response_model=UserFile,
    status_code=status.HTTP_200_OK,
    operation_id="fileDelete",
)
async def delete_file(
    filename: str,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> UserFile:
    return await file_service.delete_user_file(
        user_id=user.id,
        filename=filename,
        session=db,
    )


@file_router.get(
    "/{filename}/knowledge",
    response_model=FileKnowledgeArtifact,
    status_code=status.HTTP_200_OK,
    operation_id="fileKnowledgeGetStatus",
)
async def get_file_knowledge_status(
    filename: str,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> FileKnowledgeArtifact:
    return await file_service.get_file_knowledge_status(
        user_id=user.id,
        filename=filename,
        session=db,
    )


@file_router.post(
    "/{filename}/knowledge/retry",
    response_model=FileKnowledgeArtifact,
    status_code=status.HTTP_200_OK,
    operation_id="fileKnowledgeRetry",
)
async def retry_file_knowledge_processing(
    filename: str,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> FileKnowledgeArtifact:
    return await file_service.retry_file_knowledge_processing(
        user_id=user.id,
        filename=filename,
        session=db,
    )


@file_router.post(
    "/{filename}/knowledge/cancel",
    response_model=FileKnowledgeArtifact,
    status_code=status.HTTP_200_OK,
    operation_id="fileKnowledgeCancel",
)
async def cancel_file_knowledge_processing(
    filename: str,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> FileKnowledgeArtifact:
    return await file_service.cancel_file_knowledge_processing(
        user_id=user.id,
        filename=filename,
        session=db,
    )


@file_router.post(
    "/{filename}/knowledge/caption/regenerate",
    response_model=FileKnowledgeArtifact,
    status_code=status.HTTP_200_OK,
    operation_id="fileCaptionRegenerate",
)
async def regenerate_file_caption(
    filename: str,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> FileKnowledgeArtifact:
    return await file_service.regenerate_file_caption(
        user_id=user.id,
        filename=filename,
        session=db,
    )


@file_router.delete(
    "/{filename}/knowledge/caption",
    response_model=FileKnowledgeArtifact,
    status_code=status.HTTP_200_OK,
    operation_id="fileCaptionClear",
)
async def clear_file_caption(
    filename: str,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> FileKnowledgeArtifact:
    return await file_service.clear_file_caption(
        user_id=user.id,
        filename=filename,
        session=db,
    )


@file_router.put(
    "/{filename}/knowledge/caption",
    response_model=FileKnowledgeArtifact,
    status_code=status.HTTP_200_OK,
    operation_id="fileCaptionEdit",
)
async def edit_file_caption(
    filename: str,
    payload: FileCaptionEdit,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> FileKnowledgeArtifact:
    return await file_service.edit_file_caption(
        user_id=user.id,
        filename=filename,
        text=payload.text,
        session=db,
    )


@file_router.get(
    "/{filename}",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    operation_id="fileGetOne",
)
async def get_file(
    user: AuthedUserDep,
    filename: str,
    db: DBSessionDep,
):
    return file_service.get_user_file(
        user_id=user.id,
        filename=filename,
        session=db,
    )
