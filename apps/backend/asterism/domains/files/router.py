from fastapi import APIRouter, status
from fastapi.responses import FileResponse

import asterism.domains.files.service as file_service
from asterism.core.schemas import ErrorDetail
from asterism.domains.user.dependencies import AuthedUserDep

file_router = APIRouter(
    tags=["files"],
    prefix="/files",
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@file_router.get(
    "/{filename}",
    response_class=FileResponse,
    status_code=status.HTTP_200_OK,
    operation_id="getFile",
    responses={
        200: {
            "description": "Returns the user's file",
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
        },
        401: {"model": ErrorDetail},
        400: {"model": ErrorDetail},
        404: {"model": ErrorDetail},
    },
)
async def get_file(user: AuthedUserDep, filename: str):
    return file_service.get_user_file(
        user_id=user.id,
        filename=filename,
    )
