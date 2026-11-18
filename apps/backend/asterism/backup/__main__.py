"""``python -m asterism.backup create|restore|verify`` (US-86.4).

Locations come from the backend configuration (``STORAGE_ROOT``, ``DB_URL``).
The Better Auth database is ``--auth-db``, else ``BETTER_AUTH_DB_PATH``, else
``users.db`` in the storage root.
"""

import argparse
import asyncio
import os
import sys
import tempfile
from pathlib import Path

from asterism.core import config
from asterism.core.config import ConfigValidationError
from asterism.db.init_db import initialize_database, sqlite_database_path
from asterism.db.migrate import SchemaRevisionError, verify_database_revision

from .archive import BackupError, StorageLayout
from .create import create_backup
from .restore import restore_backup


def _layout(auth_db: str | None) -> StorageLayout:
    config.validate_runtime()
    auth = Path(auth_db or os.environ.get("BETTER_AUTH_DB_PATH") or config.storage_root / "users.db")
    if not auth.is_absolute():
        raise BackupError("The Better Auth database path must be absolute")
    return StorageLayout(storage_root=config.storage_root, backend_db=sqlite_database_path(), auth_db=auth)


def _create(options: argparse.Namespace) -> None:
    layout = _layout(options.auth_db)
    archive = create_backup(layout, Path(options.output_dir), system_key=config.system_key, keep=options.keep)
    print(f"Backup written: {archive}")


async def _startup_checks() -> None:
    await initialize_database()
    await verify_database_revision()


def _restore(options: argparse.Namespace) -> None:
    layout = _layout(options.auth_db)
    manifest = restore_backup(Path(options.archive), layout, system_key=config.system_key)
    print(
        f"Restored the backup taken {manifest['created_at']} (schema revision {manifest['schema_revision']}) "
        f"into {layout.storage_root}"
    )
    if manifest.get("skipped"):
        print(f"{len(manifest['skipped'])} file(s) were deleted while that backup ran and are not in it")
    # The normal startup path: apply pending migrations, then the API server's own check.
    asyncio.run(_startup_checks())
    print("Backend database is at this version's schema; start Asterism and check it before reopening it to users")


def _verify(options: argparse.Namespace) -> None:
    with tempfile.TemporaryDirectory(prefix="asterism-verify-", dir=options.scratch_dir) as scratch:
        root = Path(scratch) / "storage"
        layout = StorageLayout(storage_root=root, backend_db=root / "database.db", auth_db=root / "users.db")
        manifest = restore_backup(Path(options.archive), layout, system_key=config.system_key)
    print(
        f"Backup is complete and restorable by this version: taken {manifest['created_at']}, "
        f"schema revision {manifest['schema_revision']}, {len(manifest['entries'])} files"
    )


def arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m asterism.backup", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create", help="Write a backup archive while the app runs.")
    create.add_argument("--output-dir", required=True, help="Directory for archives, outside the storage root.")
    create.add_argument("--keep", type=int, help="After a successful backup, keep only the newest N archives here.")
    create.add_argument("--auth-db", help="Better Auth database path.")
    create.set_defaults(run=_create)

    restore = commands.add_parser("restore", help="Restore an archive into an empty storage root (app stopped).")
    restore.add_argument("archive", help="Backup archive (.tar.gz).")
    restore.add_argument("--auth-db", help="Better Auth database path.")
    restore.set_defaults(run=_restore)

    verify = commands.add_parser("verify", help="Run every restore check into a scratch directory, then discard it.")
    verify.add_argument("archive", help="Backup archive (.tar.gz).")
    verify.add_argument("--scratch-dir", help="Where to unpack it (default: the system temporary directory).")
    verify.set_defaults(run=_verify)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    options = arguments(argv)
    try:
        options.run(options)
    except (BackupError, SchemaRevisionError, ConfigValidationError) as error:
        print(f"{options.command} refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
