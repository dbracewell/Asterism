"""Backup archive format and the storage layout it covers.

An archive is a gzip-compressed tar named ``asterism-backup-<UTC time>.tar.gz``:

- ``databases/users.db`` and ``databases/database.db``: SQLite snapshots of the
  Better Auth and backend databases.
- ``knowledge/lancedb/``: the knowledge vectors, exported from one table version.
- ``files/`` and ``themes/``: uploaded and produced files, and custom themes.
- ``manifest.json``, the last member: format version, schema revision, a
  ``SYSTEM_KEY`` fingerprint, and the size and SHA-256 of every other member.

Downloaded model bundles (``models/``) are not included; they are fetched again.
"""

import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO

FORMAT = "asterism-backup"
FORMAT_VERSION = 1
MANIFEST = "manifest.json"
AUTH_DB = "databases/users.db"
BACKEND_DB = "databases/database.db"
VECTORS = "knowledge/lancedb"
# Storage-root trees copied file by file.
TREES = ("files", "themes")
ALLOWED_PREFIXES = ("files/", "themes/", f"{VECTORS}/")
ARCHIVE_PATTERN = re.compile(r"asterism-backup-\d{8}T\d{6}Z\.tar\.gz")
MAX_MANIFEST_BYTES = 256 * 1024 * 1024
_KEY_CHECK_CONTEXT = b"asterism-backup/system-key-check/v1"


class BackupError(RuntimeError):
    """A backup or restore cannot go ahead; the message says why."""


@dataclass(frozen=True)
class StorageLayout:
    """Where one instance keeps its data."""

    storage_root: Path
    backend_db: Path
    auth_db: Path

    @property
    def vectors_root(self) -> Path:
        return self.storage_root / VECTORS

    def tree(self, name: str) -> Path:
        return self.storage_root / name


def app_version() -> str:
    try:
        return metadata.version("asterism-core")
    except metadata.PackageNotFoundError:
        return "unknown"


def system_key_check(system_key: str) -> str | None:
    """A fingerprint that tells whether two ``SYSTEM_KEY`` values match, without revealing the key."""
    if not system_key:
        return None
    return hmac.new(system_key.encode(), _KEY_CHECK_CONTEXT, hashlib.sha256).hexdigest()[:32]


def member_name_allowed(name: str) -> bool:
    """Only plain relative paths inside the known archive areas."""
    if not name or "\\" in name or "\0" in name:
        return False
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in ("", ".", "..") for part in name.split("/")):
        return False
    return name in (MANIFEST, AUTH_DB, BACKEND_DB) or name.startswith(ALLOWED_PREFIXES)


class HashingReader:
    """Wrap a binary file, hashing and counting what is read through it."""

    def __init__(self, file: BinaryIO) -> None:
        self._file = file
        self._hash = hashlib.sha256()
        self.size = 0

    def read(self, size: int = -1) -> bytes:
        data = self._file.read(size)
        self._hash.update(data)
        self.size += len(data)
        return data

    @property
    def sha256(self) -> str:
        return self._hash.hexdigest()


def encode_manifest(manifest: dict[str, Any]) -> bytes:
    return (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()


def decode_manifest(data: bytes) -> dict[str, Any]:
    try:
        manifest = json.loads(data)
    except ValueError as error:
        raise BackupError("The archive's manifest is not valid JSON; the archive is damaged") from error
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
        raise BackupError("The archive is not an Asterism backup")
    version = manifest.get("format_version")
    if version != FORMAT_VERSION:
        raise BackupError(
            f"The backup uses archive format {version}; this version of Asterism reads format {FORMAT_VERSION}. "
            "Restore it with the version of Asterism that made it."
        )
    entries = manifest.get("entries")
    if not isinstance(entries, list) or not all(
        isinstance(entry, dict)
        and isinstance(entry.get("path"), str)
        and isinstance(entry.get("size"), int)
        and isinstance(entry.get("sha256"), str)
        for entry in entries
    ):
        raise BackupError("The archive's manifest has no valid entry list; the archive is damaged")
    if not isinstance(manifest.get("schema_revision"), str):
        raise BackupError("The archive's manifest names no schema revision; the archive is damaged")
    return manifest
