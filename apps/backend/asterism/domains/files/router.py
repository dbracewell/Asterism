"""HTTP transport for the file domain.

Every route is authenticated and user-scoped: the ``user_id`` used for every
lookup comes from the auth dependency, never from the request body or path.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, File, Query, Request, UploadFile, status
from fastapi.responses import FileResponse

import asterism.domains.files.service as file_service
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.extraction.schemas import FileKnowledgeArtifact
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import SimilarFileList, UserFile, UserFileList

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
"""Router exposing the caller's own file library."""


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
    """Upload one or more files into the caller's library.

    Args:
        user: The authenticated caller.
        db: Request-scoped database session.
        files: Uploaded files; each is sanitized, de-duplicated and stored.

    Returns:
        The files that now exist for the caller. Uploading a file that already
        exists with identical name and content reuses the existing row.
    """
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
    """List the caller's files.

    Args:
        user: The authenticated caller.
        db: Request-scoped database session.
        page: 1-based page number.
        page_size: Number of files per page (1..100).
        sort_by: Primary ordering key.
        query: Optional case-insensitive substring filter on the file name.

    Returns:
        One page of the caller's files with project and knowledge context.
    """
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
    """Delete several files from the caller's library.

    Args:
        user: The authenticated caller.
        filenames: Display names of the files to delete. Unknown names are
            ignored rather than reported as errors.
        session: Request-scoped database session.

    Returns:
        The files that were deleted, with the context they had at deletion
        time.
    """
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
    """Get metadata for one of the caller's files.

    Args:
        user: The authenticated caller.
        filename: Display name of the file.
        session: Request-scoped database session.

    Returns:
        The file's metadata, including its project and knowledge context.
    """
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
    """Delete one file from the caller's library.

    Args:
        filename: Display name of the file to delete.
        user: The authenticated caller.
        db: Request-scoped database session.

    Returns:
        The deleted file's metadata as it was just before deletion.
    """
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
    """Get the knowledge-artifact status for one of the caller's files.

    Args:
        filename: Display name of the file.
        user: The authenticated caller.
        db: Request-scoped database session.

    Returns:
        The newest knowledge artifact for the file.
    """
    return await file_service.get_file_knowledge_status(
        user_id=user.id,
        filename=filename,
        session=db,
    )


@file_router.post(
    "/{filename}/knowledge/regenerate",
    response_model=FileKnowledgeArtifact,
    status_code=status.HTTP_200_OK,
    operation_id="fileKnowledgeRegenerate",
)
async def regenerate_file_knowledge(
    filename: str,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> FileKnowledgeArtifact:
    """Re-run knowledge processing for one of the caller's files.

    Args:
        filename: Display name of the file.
        user: The authenticated caller.
        db: Request-scoped database session.

    Returns:
        The artifact that was reset to ``pending`` and re-queued.
    """
    return await file_service.regenerate_file_knowledge(
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
    """Cancel in-flight knowledge processing for one of the caller's files.

    Args:
        filename: Display name of the file.
        user: The authenticated caller.
        db: Request-scoped database session.

    Returns:
        The artifact in its current (possibly canceled) state.
    """
    return await file_service.cancel_file_knowledge_processing(
        user_id=user.id,
        filename=filename,
        session=db,
    )


@file_router.get(
    "/{filename}/similar",
    response_model=SimilarFileList,
    status_code=status.HTTP_200_OK,
    operation_id="fileSimilarGetMany",
)
async def get_similar_files(
    filename: str,
    user: AuthedUserDep,
    db: DBSessionDep,
    limit: int = Query(default=5, ge=1, le=20),
) -> SimilarFileList:
    """Find the caller's files most similar to one of their files.

    Args:
        filename: Display name of the query file.
        user: The authenticated caller.
        db: Request-scoped database session.
        limit: Maximum number of similar files to return (1..20).

    Returns:
        Ranked similar files with their cosine similarity score.
    """
    return await file_service.get_similar_files(user_id=user.id, filename=filename, session=db, limit=limit)


@file_router.get(
    "/{filename}",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    operation_id="fileGetOne",
    responses={
        status.HTTP_200_OK: {
            "description": "File download",
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"},
                },
            },
        },
    },
)
async def get_file(
    request: Request,
    user: AuthedUserDep,
    filename: str,
    db: DBSessionDep,
):
    """Download the original bytes of one of the caller's files.

    Args:
        request: The incoming request, used for conditional-request headers.
        user: The authenticated caller.
        filename: Display name of the file.
        db: Request-scoped database session.

    Returns:
        A ``200`` file response, or a ``304`` when the client's ``ETag``
        already matches the stored content.
    """
    return await file_service.get_user_file(
        user_id=user.id,
        filename=filename,
        session=db,
        if_none_match=request.headers.get("if-none-match"),
    )
