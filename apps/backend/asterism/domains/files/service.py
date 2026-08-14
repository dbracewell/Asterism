import re

from fastapi.responses import FileResponse

from asterism.common.file_utils import get_file_mime_type
from asterism.core import config
from asterism.core.exceptions import BadDataException, NotFoundException


def get_user_file(user_id: str, filename: str) -> FileResponse:
    # handle some encoding issues
    filename = re.sub("%2E", ".", filename)
    filename = re.sub(r"^\.+", "", filename)

    requested_path = config.get_user_file(filename=filename, user_id=user_id).resolve()

    if not str(requested_path).startswith(str(config.files_root)):
        raise BadDataException(f"Access to {requested_path} is denied")

    if not requested_path.exists() or not requested_path.is_file():
        raise NotFoundException(f"Access to {requested_path} is denied")

    return FileResponse(
        path=requested_path,
        filename=filename,
        media_type=get_file_mime_type(requested_path),
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    )
