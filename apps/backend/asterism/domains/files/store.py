"""Original source storage. Keys are opaque to consumers; only this adapter resolves paths.

The store owns the mapping from an opaque ``storage_key`` to a byte location.
Everything above this module works with keys only, which keeps the filesystem
layout (or an object-store bucket) replaceable without touching domain code.

Security contract:

- Keys are opaque and owner-scoped: the first path segment is the URL-quoted
  owner id, so one user can never address another user's bytes.
- Every key is validated against a strict shape before it is turned into a
  path, and the resolved path is re-checked for containment inside the root,
  which also rejects symlink escapes.
"""

import re
import shutil
import uuid
from pathlib import Path
from typing import Protocol
from urllib.parse import quote


class FileStore(Protocol):
    """Adapter contract for persisting the original bytes of an uploaded file.

    Implementations must keep keys opaque to callers and must reject any key
    that does not belong to the requesting owner.
    """

    def save(
        self,
        user_id: str,
        file_id: uuid.UUID,
        extension: str,
        content: bytes,
    ) -> str:
        """Persist *content* for a new file and return its storage key.

        Args:
            user_id: Owner of the file; becomes the first key segment.
            file_id: Identifier of the file row the bytes belong to.
            extension: Lower-case file extension including the dot (``.pdf``),
                or an empty string for no extension.
            content: Raw bytes to store.

        Returns:
            The opaque storage key that later resolves to the stored bytes.

        Raises:
            FileExistsError: If the key already exists (writes are exclusive).
        """
        ...

    def open(
        self,
        user_id: str,
        storage_key: str,
    ) -> Path:
        """Resolve a storage key to a readable path owned by ``user_id``.

        Args:
            user_id: Owner the key must belong to.
            storage_key: Key previously returned by :meth:`save`.

        Returns:
            The absolute path of the stored bytes. The file is not guaranteed
            to exist; callers must check.

        Raises:
            ValueError: If the key is malformed or belongs to another owner.
        """
        ...

    def delete(
        self,
        user_id: str,
        storage_key: str,
    ) -> None:
        """Remove the bytes for one key.

        Args:
            user_id: Owner the key must belong to.
            storage_key: Key previously returned by :meth:`save`.

        Raises:
            ValueError: If the key is malformed or belongs to another owner.
        """
        ...

    def delete_user(self, user_id: str) -> None:
        """Remove every stored source belonging to one user.

        Args:
            user_id: Owner whose entire shard should be discarded.
        """
        ...


class LocalFileStore:
    """User-scoped, ID-sharded sources independent of workspace organization.

    The on-disk layout is::

        <root>/<owner>/<xx>/<yy>/<file-id>/source<ext>

    where ``xx``/``yy`` are the first four hex characters of the file id. The
    two-level shard keeps directory sizes small without leaking ownership
    information beyond the opaque owner segment.
    """

    def __init__(self, root: Path) -> None:
        """Bind the store to a root directory.

        Args:
            root: Directory that holds all owner shards.
        """
        self.root = root.resolve()

    @staticmethod
    def _owner(user_id: str) -> str:
        """Encode an owner id into a single safe path segment.

        Args:
            user_id: Raw owner id.

        Returns:
            The URL-quoted owner id, which can never contain a path separator.

        Raises:
            ValueError: If the owner id is empty or a relative-path token.
        """
        if not user_id or user_id in {".", ".."}:
            raise ValueError("Invalid file owner")
        return quote(user_id, safe="")

    def _path(
        self,
        user_id: str,
        storage_key: str,
    ) -> Path:
        """Validate a storage key and resolve it to an absolute path.

        Args:
            user_id: Owner the key must belong to.
            storage_key: Key to resolve.

        Returns:
            The resolved absolute path of the stored bytes.

        Raises:
            ValueError: If the key has the wrong shape, belongs to another
                owner, or resolves outside the store root.
        """
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

    def save(
        self,
        user_id: str,
        file_id: uuid.UUID,
        extension: str,
        content: bytes,
    ) -> str:
        """Write *content* to a fresh, exclusively created source file.

        Args:
            user_id: Owner of the file.
            file_id: Identifier of the file row the bytes belong to.
            extension: Extension including the dot; anything outside
                ``.[a-z0-9]{1,16}`` is dropped rather than rejected.
            content: Raw bytes to store.

        Returns:
            The opaque storage key of the written file.

        Raises:
            FileExistsError: If the target path already exists.
            ValueError: If the owner id is invalid.
        """
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
            # Never leave a half-written source behind.
            path.unlink(missing_ok=True)
            raise
        return key

    def open(self, user_id: str, storage_key: str) -> Path:
        """Resolve a key to its path without touching the filesystem.

        Args:
            user_id: Owner the key must belong to.
            storage_key: Key previously returned by :meth:`save`.

        Returns:
            The absolute path of the stored bytes.

        Raises:
            ValueError: If the key is malformed or belongs to another owner.
        """
        return self._path(user_id, storage_key)

    def delete(
        self,
        user_id: str,
        storage_key: str,
    ) -> None:
        """Delete one stored source; a missing file is not an error.

        Args:
            user_id: Owner the key must belong to.
            storage_key: Key previously returned by :meth:`save`.

        Raises:
            ValueError: If the key is malformed or belongs to another owner.
        """
        self._path(user_id, storage_key).unlink(missing_ok=True)

    def delete_user(self, user_id: str) -> None:
        """Remove every stored source for a user (their whole owner shard)."""
        owner_dir = (self.root / self._owner(user_id)).resolve()
        # The owner name is URL-quoted and non-empty by construction, but keep
        # the containment check so a future owner scheme cannot escape root.
        owner_dir.relative_to(self.root)
        shutil.rmtree(owner_dir, ignore_errors=True)


def get_file_store() -> FileStore:
    """Build the file store configured for this deployment.

    Returns:
        A :class:`FileStore` rooted at ``config.files_root``.
    """
    from asterism.core import config

    return LocalFileStore(config.files_root)
