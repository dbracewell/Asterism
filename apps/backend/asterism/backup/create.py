"""Take a consistent backup while the app runs.

Order matters. Both SQLite databases are snapshotted first, each with the
SQLite online backup API in one step: a read transaction that sees one commit
and does not block writers (WAL). Files and vectors are copied afterwards, so
everything a snapshotted row refers to already existed when the snapshot was
taken. The file store writes a source before committing its row, so a file
still being written can only be an orphan, never a referenced partial file.
A file deleted between the snapshot and its copy is listed as skipped in the
manifest.

The LanceDB table changes in place as knowledge is processed, so it is not
copied as files; each table is pinned to its current version and exported.
"""

import fcntl
import io
import json
import os
import shutil
import sqlite3
import tarfile
import tempfile
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import lancedb

from asterism.core.build_info import app_commit, app_version

from .archive import (
    ARCHIVE_PATTERN,
    AUTH_DB,
    BACKEND_DB,
    FORMAT,
    FORMAT_VERSION,
    MANIFEST,
    TREES,
    VECTORS,
    BackupError,
    HashingReader,
    StorageLayout,
    encode_manifest,
    system_key_check,
)

COMPRESS_LEVEL = 6


def snapshot_sqlite(source: Path, target: Path) -> None:
    """Copy one SQLite database consistently into a standalone file."""
    if not source.is_file():
        raise BackupError(f"Database not found: {source}")
    origin = sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)
    copy = sqlite3.connect(target)
    try:
        origin.backup(copy)
        # The copy is one self-contained file, not a WAL database with sidecars.
        copy.execute("PRAGMA journal_mode=DELETE")
        result = copy.execute("PRAGMA quick_check").fetchone()
        if result != ("ok",):
            raise BackupError(f"The snapshot of {source.name} failed its integrity check: {result}")
    except sqlite3.Error as error:
        raise BackupError(f"Could not snapshot {source}: {error}") from error
    finally:
        copy.close()
        origin.close()


def snapshot_revision(database: Path) -> str:
    with sqlite3.connect(database) as connection:
        try:
            row = connection.execute("SELECT version_num FROM alembic_version").fetchone()
        except sqlite3.OperationalError:
            row = None
    if not row:
        raise BackupError(
            "The backend database has no schema revision; start the app once (or run init:db) before backing up"
        )
    return row[0]


def export_vectors(source: Path, target: Path) -> dict[str, int]:
    """Export every LanceDB table at one version each; returns row counts."""
    if not source.is_dir():
        return {}
    origin = lancedb.connect(str(source))
    copy = lancedb.connect(str(target))
    counts: dict[str, int] = {}
    for name in origin.table_names():
        table = origin.open_table(name)
        table.checkout(table.version)
        data = table.to_arrow()
        copy.create_table(name, data=data if data.num_rows else None, schema=table.schema)
        counts[name] = data.num_rows
    return counts


def _walk(root: Path) -> Iterator[Path]:
    """Regular files under ``root``, sorted, never following symlinks."""
    for directory, directories, files in os.walk(root):
        directories.sort()
        for name in sorted(files):
            path = Path(directory, name)
            if path.is_symlink() or not path.is_file():
                continue
            # Themes are written to a hidden temporary file and renamed into place.
            if name.startswith(".") and name.endswith(".tmp"):
                continue
            yield path


class _ArchiveWriter:
    def __init__(self, archive: tarfile.TarFile) -> None:
        self._archive = archive
        self.entries: list[dict[str, Any]] = []
        self.skipped: list[str] = []

    def add(self, path: Path, name: str, *, required: bool = True) -> None:
        try:
            file = path.open("rb")
        except FileNotFoundError:
            if required:
                raise
            self.skipped.append(name)
            return
        with file:
            info = tarfile.TarInfo(name)
            info.size = os.fstat(file.fileno()).st_size
            info.mtime = int(os.fstat(file.fileno()).st_mtime)
            info.mode = 0o600
            reader = HashingReader(file)
            self._archive.addfile(info, reader)  # pyright: ignore[reportArgumentType]
            self.entries.append({"path": name, "size": reader.size, "sha256": reader.sha256})

    def add_tree(self, root: Path, prefix: str, *, required: bool) -> None:
        if not root.is_dir():
            return
        for path in _walk(root):
            self.add(path, f"{prefix}/{path.relative_to(root).as_posix()}", required=required)

    def add_bytes(self, name: str, data: bytes) -> None:
        info = tarfile.TarInfo(name)
        info.size = len(data)
        info.mtime = int(datetime.now(UTC).timestamp())
        info.mode = 0o600
        self._archive.addfile(info, io.BytesIO(data))


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


LAST_BACKUP = ".last-backup.json"


def record_last_backup(layout: StorageLayout, archive: Path, moment: datetime) -> None:
    """Note the newest backup in the storage root for Admin Settings → Status (US-86.6). Best effort."""
    marker = layout.storage_root / LAST_BACKUP
    data = {
        "created_at": int(moment.timestamp()),
        "archive": archive.name,
        "size_bytes": archive.stat().st_size,
    }
    try:
        temporary = marker.with_name(f"{LAST_BACKUP}.tmp")
        temporary.write_text(json.dumps(data) + "\n")
        temporary.replace(marker)
    except OSError as error:
        print(f"Warning: could not record the backup time in {marker}: {error}")


def prune(output_dir: Path, keep: int) -> list[Path]:
    """Delete all but the newest ``keep`` backups in ``output_dir``; returns what was deleted."""
    archives = sorted(path for path in output_dir.iterdir() if ARCHIVE_PATTERN.fullmatch(path.name))
    removed = archives[:-keep]
    for path in removed:
        path.unlink()
    return removed


def create_backup(
    layout: StorageLayout,
    output_dir: Path,
    *,
    system_key: str = "",
    keep: int | None = None,
    now: datetime | None = None,
) -> Path:
    """Write one backup archive into ``output_dir`` and return its path."""
    output_dir = output_dir.resolve()
    if output_dir.is_relative_to(layout.storage_root.resolve()):
        raise BackupError("Keep backups outside the storage root, on other storage if you can")
    if keep is not None and keep < 1:
        raise BackupError("--keep must be at least 1")
    output_dir.mkdir(parents=True, exist_ok=True)
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    name = f"asterism-backup-{moment:%Y%m%dT%H%M%SZ}.tar.gz"
    final = output_dir / name
    if final.exists():
        raise BackupError(f"{final} already exists; wait a second and try again")

    lock = (output_dir / ".asterism-backup.lock").open("w")
    try:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise BackupError(f"Another backup into {output_dir} is running") from error
        staging = Path(tempfile.mkdtemp(prefix=".asterism-backup-", dir=output_dir))
        partial = output_dir / f".{name}.partial"
        try:
            snapshot_sqlite(layout.auth_db, staging / "users.db")
            snapshot_sqlite(layout.backend_db, staging / "database.db")
            revision = snapshot_revision(staging / "database.db")
            vector_tables = export_vectors(layout.vectors_root, staging / "lancedb")

            descriptor = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as file:
                with tarfile.open(fileobj=file, mode="w:gz", compresslevel=COMPRESS_LEVEL) as archive:
                    writer = _ArchiveWriter(archive)
                    writer.add(staging / "users.db", AUTH_DB)
                    writer.add(staging / "database.db", BACKEND_DB)
                    writer.add_tree(staging / "lancedb", VECTORS, required=True)
                    for tree in TREES:
                        writer.add_tree(layout.tree(tree), tree, required=False)
                    manifest = {
                        "format": FORMAT,
                        "format_version": FORMAT_VERSION,
                        "created_at": moment.isoformat().replace("+00:00", "Z"),
                        "app_version": app_version(),
                        "app_commit": app_commit(),
                        "schema_revision": revision,
                        "system_key_check": system_key_check(system_key),
                        "vector_tables": vector_tables,
                        "skipped": writer.skipped,
                        "entries": writer.entries,
                    }
                    writer.add_bytes(MANIFEST, encode_manifest(manifest))
                file.flush()
                os.fsync(file.fileno())
            partial.rename(final)
            _fsync_directory(output_dir)
        except BaseException:
            partial.unlink(missing_ok=True)
            raise
        finally:
            shutil.rmtree(staging, ignore_errors=True)
        if keep is not None:
            prune(output_dir, keep)
        record_last_backup(layout, final, moment)
        return final
    finally:
        lock.close()
