"""Original source storage. Keys are opaque to consumers; only this adapter resolves paths."""

import re
import uuid
from pathlib import Path
from typing import Protocol
from urllib.parse import quote


class FileStore(Protocol):
    def save(self, user_id: str, file_id: uuid.UUID, extension: str, content: bytes) -> str: ...

    def open(self, user_id: str, storage_key: str) -> Path: ...

    def delete(self, user_id: str, storage_key: str) -> None: ...


class LocalFileStore:
    """User-scoped, ID-sharded sources independent of workspace organization."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    @staticmethod
    def _owner(user_id: str) -> str:
        if not user_id or user_id in {".", ".."}:
            raise ValueError("Invalid file owner")
        return quote(user_id, safe="")

    def _path(self, user_id: str, storage_key: str) -> Path:
        parts = storage_key.split("/")
        if len(parts) != 5 or parts[0] != self._owner(user_id):
            raise ValueError("Invalid storage key or owner")
        try:
            file_id = uuid.UUID(parts[3])
        except ValueError as error:
            raise ValueError("Invalid storage key") from error
        if (parts[1], parts[2], parts[3]) != (file_id.hex[:2], file_id.hex[2:4], str(file_id)):
            raise ValueError("Invalid storage key")
        if not re.fullmatch(r"source(?:\.[a-z0-9]{1,16})?", parts[4]):
            raise ValueError("Invalid storage key")
        path = (self.root / storage_key).resolve()
        try:
            path.relative_to(self.root / parts[0])
        except ValueError as error:
            raise ValueError("Invalid storage key") from error
        return path

    def save(self, user_id: str, file_id: uuid.UUID, extension: str, content: bytes) -> str:
        extension = extension.lower()
        if extension and not re.fullmatch(r"\.[a-z0-9]{1,16}", extension):
            extension = ""
        key = f"{self._owner(user_id)}/{file_id.hex[:2]}/{file_id.hex[2:4]}/{file_id}/source{extension}"
        path = self._path(user_id, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("xb") as file:
                file.write(content)
        except FileExistsError:
            raise
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return key

    def open(self, user_id: str, storage_key: str) -> Path:
        return self._path(user_id, storage_key)

    def delete(self, user_id: str, storage_key: str) -> None:
        self._path(user_id, storage_key).unlink(missing_ok=True)


def get_file_store() -> FileStore:
    from asterism.core import config

    return LocalFileStore(config.files_root)
