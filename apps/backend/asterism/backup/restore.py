"""Restore a backup, offline, into an empty storage root.

The archive is extracted into a staging directory inside the storage root and
checked before anything is moved into place: every member against the
manifest's size and SHA-256, the schema revision against this code's migration
history, the ``SYSTEM_KEY`` fingerprint, SQLite integrity, and the vector row
counts. A refused restore leaves no data behind. After the move the normal
startup path runs (``init_db``), which applies pending migrations.
"""

import gzip
import shutil
import sqlite3
import tarfile
import uuid
import zlib
from pathlib import Path
from typing import Any

import lancedb

from asterism.db.migrate import head_revision, script_directory

from .archive import (
    AUTH_DB,
    BACKEND_DB,
    MANIFEST,
    MAX_MANIFEST_BYTES,
    TREES,
    VECTORS,
    BackupError,
    HashingReader,
    StorageLayout,
    decode_manifest,
    member_name_allowed,
    system_key_check,
)

_CHUNK = 1024 * 1024


def _require_empty_target(layout: StorageLayout) -> None:
    root = layout.storage_root
    if root.exists() and (not root.is_dir() or any(root.iterdir())):
        raise BackupError(f"Restore needs an empty storage root; {root} is not empty")
    for database in (layout.backend_db, layout.auth_db):
        if database.exists():
            raise BackupError(f"Restore will not overwrite {database}; move it away first")


def _extract(archive: Path, staging: Path) -> tuple[dict[str, tuple[int, str]], bytes]:
    """Extract regular-file members into ``staging``, hashing each; returns them and the manifest."""
    found: dict[str, tuple[int, str]] = {}
    manifest: bytes | None = None
    try:
        with tarfile.open(archive, mode="r|gz") as tar:
            for member in tar:
                name = member.name
                if not member.isfile() or not member_name_allowed(name):
                    raise BackupError(f"The archive contains an unexpected entry {name!r}; it is not a backup")
                if name in found or (name == MANIFEST and manifest is not None):
                    raise BackupError(f"The archive contains {name!r} twice; it is damaged")
                source = tar.extractfile(member)
                if source is None:
                    raise BackupError(f"The archive entry {name!r} cannot be read")
                if name == MANIFEST:
                    if member.size > MAX_MANIFEST_BYTES:
                        raise BackupError("The archive's manifest is too large; it is damaged")
                    manifest = source.read()
                    continue
                target = staging / name
                target.parent.mkdir(parents=True, exist_ok=True)
                reader = HashingReader(source)  # pyright: ignore[reportArgumentType]
                with target.open("xb") as file:
                    while chunk := reader.read(_CHUNK):
                        file.write(chunk)
                found[name] = (reader.size, reader.sha256)
    except (tarfile.TarError, EOFError, zlib.error, gzip.BadGzipFile) as error:
        raise BackupError(f"The archive is damaged or not an Asterism backup ({error})") from error
    if manifest is None:
        raise BackupError("The archive has no manifest; it is damaged or incomplete")
    return found, manifest


def _verify_entries(manifest: dict[str, Any], found: dict[str, tuple[int, str]]) -> None:
    expected = {entry["path"]: (entry["size"], entry["sha256"]) for entry in manifest["entries"]}
    for required in (AUTH_DB, BACKEND_DB):
        if required not in expected:
            raise BackupError(f"The backup has no {required}; it is damaged")
    missing = sorted(expected.keys() - found.keys())
    if missing:
        raise BackupError(f"The archive is missing {len(missing)} file(s) the manifest lists, such as {missing[0]}")
    extra = sorted(found.keys() - expected.keys())
    if extra:
        raise BackupError(f"The archive contains {extra[0]}, which the manifest does not list; it is damaged")
    for name, (size, digest) in expected.items():
        if found[name] != (size, digest):
            raise BackupError(f"Checksum mismatch for {name}; the archive is damaged")


def _verify_revision(manifest: dict[str, Any], backend_db: Path) -> str:
    revision = manifest["schema_revision"]
    head = head_revision()
    known = {script.revision for script in script_directory().walk_revisions()}
    if revision not in known:
        raise BackupError(
            f"The backup is at schema revision {revision}, which this code does not know "
            f"(this code is at {head}). It was probably taken by a newer version of Asterism; "
            "restore it with that version."
        )
    with sqlite3.connect(backend_db) as connection:
        row = connection.execute("SELECT version_num FROM alembic_version").fetchone()
    if row != (revision,):
        raise BackupError("The backend database's schema revision does not match the manifest; the archive is damaged")
    return revision


def _verify_databases(staging: Path) -> None:
    for name in (AUTH_DB, BACKEND_DB):
        with sqlite3.connect(staging / name) as connection:
            result = connection.execute("PRAGMA integrity_check").fetchall()
        if result != [("ok",)]:
            raise BackupError(f"{name} in the backup failed its integrity check")


def _verify_vectors(manifest: dict[str, Any], vectors: Path) -> None:
    expected = manifest.get("vector_tables") or {}
    if not expected:
        return
    database = lancedb.connect(str(vectors))
    for name, rows in expected.items():
        try:
            count = database.open_table(name).count_rows()
        except Exception as error:
            raise BackupError(f"The backup's vector table {name} cannot be opened") from error
        if count != rows:
            raise BackupError(f"The backup's vector table {name} has {count} rows, not {rows}")


def _move_into_place(staging: Path, layout: StorageLayout) -> None:
    for name, target in ((BACKEND_DB, layout.backend_db), (AUTH_DB, layout.auth_db)):
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(staging / name, target)
    for tree in (*TREES, VECTORS.split("/")[0]):
        if (staging / tree).exists():
            (staging / tree).rename(layout.storage_root / tree)


def restore_backup(archive: Path, layout: StorageLayout, *, system_key: str = "") -> dict[str, Any]:
    """Check and restore ``archive`` into ``layout``; returns the manifest. Does not run migrations."""
    if not archive.is_file():
        raise BackupError(f"Backup archive not found: {archive}")
    _require_empty_target(layout)
    layout.storage_root.mkdir(parents=True, exist_ok=True)
    staging = layout.storage_root / f".restore-{uuid.uuid4().hex}"
    staging.mkdir()
    try:
        found, raw_manifest = _extract(archive, staging)
        manifest = decode_manifest(raw_manifest)
        _verify_entries(manifest, found)
        _verify_revision(manifest, staging / BACKEND_DB)
        recorded = manifest.get("system_key_check")
        current = system_key_check(system_key)
        if recorded and current and recorded != current:
            raise BackupError(
                "This backup was taken with a different SYSTEM_KEY, so stored provider keys could not be read. "
                "Restore with the SYSTEM_KEY the backed-up instance used."
            )
        _verify_databases(staging)
        _verify_vectors(manifest, staging / VECTORS)
        _move_into_place(staging, layout)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return manifest
