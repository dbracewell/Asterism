from collections.abc import Iterator
from pathlib import Path
from typing import Protocol


class FileStore(Protocol):
    def save(self, user_id: str, filename: str, content: bytes) -> Path: ...

    def open(self, user_id: str, filename: str) -> Path: ...

    def delete(self, user_id: str, filename: str) -> None: ...

    def stat(self, user_id: str, filename: str): ...

    def list(self, user_id: str) -> Iterator[Path]: ...


class LocalFileStore:
    """Filesystem implementation with a separate, traversal-safe root per user."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _user_root(self, user_id: str) -> Path:
        # Auth user IDs are opaque data, never path components supplied by a route.
        root = (self.root / user_id).resolve()
        try:
            root.relative_to(self.root)
        except ValueError as error:
            raise ValueError("Invalid file owner") from error
        return root

    def _path(self, user_id: str, filename: str) -> Path:
        if not filename or Path(filename).name != filename or "/" in filename or "\\" in filename:
            raise ValueError("Invalid filename")
        path = (self._user_root(user_id) / filename).resolve()
        try:
            path.relative_to(self._user_root(user_id))
        except ValueError as error:
            raise ValueError("Invalid filename") from error
        return path

    def save(self, user_id: str, filename: str, content: bytes) -> Path:
        path = self._path(user_id, filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation guarantees collision handling cannot overwrite a file.
        with path.open("xb") as file:
            file.write(content)
        return path

    def open(self, user_id: str, filename: str) -> Path:
        return self._path(user_id, filename)

    def delete(self, user_id: str, filename: str) -> None:
        path = self._path(user_id, filename)
        path.unlink(missing_ok=True)

    def stat(self, user_id: str, filename: str):
        return self._path(user_id, filename).stat()

    def list(self, user_id: str) -> Iterator[Path]:
        root = self._user_root(user_id)
        if not root.is_dir():
            return iter(())
        return (path for path in root.iterdir() if path.is_file())
