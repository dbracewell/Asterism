import re

import filetype
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from asterism.config import config
from asterism.routers.base import JwtSecurityToken
from asterism.routers.typedefs import ErrorDetail
from asterism.utils.security import verify_jwks_token


def get_file_mime_type(file_path) -> str:
    kind = filetype.guess(file_path)
    if kind is None:
        match file_path[-3:].lower():
            case "png":
                return "image/png"
            case "jpg":
                return "image/jpg"
            case "webp":
                return "image/webp"
        return "text/plain"
    return kind.mime


file_router = APIRouter(
    tags=["files"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@file_router.get(
    "/api/files/{filename}",
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
async def get_file(credentials: JwtSecurityToken, filename: str):
    try:
        user_id = verify_jwks_token(credentials.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")

    filename = re.sub("%2E", ".", filename)
    filename = re.sub(r"^\.+", "", filename)
    requested_path = config.get_user_file(
        filename=filename,
        user_id=user_id,
    ).resolve()

    if not str(requested_path).startswith(str(config.FILES_ROOT)):
        raise HTTPException(status_code=400, detail="Invalid filename")

    if not requested_path.exists() or not requested_path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(
        path=requested_path,
        filename=filename,
        media_type=get_file_mime_type(requested_path),
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )
