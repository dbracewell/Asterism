"""Database initialization CLI (``python -m asterism.db.init_db``).

Creates missing tables, installs the chat full-text search indexes, and seeds
the ``active_tools`` application setting. With ``--reset`` it first deletes the
local SQLite database (plus WAL/SHM/journal sidecar files) and the disposable
source/knowledge storage trees; model bundles are never touched.

Per project policy the dev database is disposable: this tool deletes instead of
migrating, and ``create_all`` re-initializes the schema from current models.
"""

import argparse
import asyncio
import shutil
import sys
from pathlib import Path

from sqlalchemy import insert
from sqlalchemy.engine import make_url

from asterism.common.log import DEFAULT_LOGGER
from asterism.core import config
from asterism.domains.chat.search_index import initialize_search_index
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.tools.catalog import INTERNAL_TOOL_NAMES

from .database import db_session_manager, get_async_db_session
from .model_registry import Base


def sqlite_database_path() -> Path:
    """Resolve the configured database URL to a local SQLite file path.

    Raises:
        RuntimeError: if the URL is unset, not a local SQLite target, or its
            database part is not an absolute path (reset must never guess a
            location).
    """
    if not config.db_url:
        raise RuntimeError("Database URL is not set in the configuration")
    url = make_url(config.db_url)
    if not url.drivername.startswith("sqlite") or not url.database:
        raise RuntimeError("Database reset supports only a local SQLite target")
    path = Path(url.database)
    if not path.is_absolute():
        raise RuntimeError("Database reset requires an absolute SQLite path")
    return path.resolve()


def delete_database_files(path: Path) -> None:
    """Delete the SQLite database file and its WAL/SHM/journal sidecars.

    Sidecar files are removed even when the main file is absent, so a crash
    between runs cannot leave stale ``-wal``/``-shm`` content behind.
    """
    for candidate in (
        path,
        *(Path(f"{path}-{ext}") for ext in ("wal", "shm", "journal")),
    ):
        if candidate.exists():
            candidate.unlink()


def confirmed_reset(path: Path, assume_yes: bool) -> bool:
    """Ask the operator to type RESET before destructive deletion.

    Args:
        path: The SQLite file that would be deleted (shown for verification).
        assume_yes: Skip the prompt entirely (scripted ``--yes`` runs).

    Returns:
        True only when deletion is confirmed; False cancels the reset. A
        non-interactive stdin without ``--yes`` always declines, so piped or
        CI invocations can never destroy data accidentally.
    """
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        return False
    print(f"Backend database selected for deletion: {path}")
    print(f"Disposable source storage selected for deletion: {config.files_root}")
    print(f"Disposable knowledge storage selected for deletion: {config.knowledge_root}")
    return input("Type RESET to continue: ") == "RESET"


async def initialize_database(*, reset: bool = False, assume_yes: bool = False) -> None:
    """Initialize (and optionally reset first) the backend database.

    Steps: validate config; optionally delete DB + disposable storage behind a
    confirmation; recreate storage directories; create missing tables; install
    FTS indexes; seed the ``active_tools`` setting if absent; close the
    session manager so callers (e.g. tests) start from a clean slate.

    Args:
        reset: Delete the SQLite database and source/knowledge storage first.
        assume_yes: Bypass the interactive RESET confirmation (use with care).
    """
    config.validate_runtime()
    if reset:
        database_path = sqlite_database_path()
        if not confirmed_reset(database_path, assume_yes):
            raise RuntimeError("Database reset canceled; no files were deleted")
        DEFAULT_LOGGER.warning("Deleting the selected backend SQLite database")
        delete_database_files(database_path)
        for root in (config.files_root, config.knowledge_root):
            if root.is_symlink():
                # Refuse to follow a symlinked root: unlink the link itself so
                # we never rmtree something outside the configured location.
                root.unlink()
            elif root.exists():
                shutil.rmtree(root)

    config.prepare_storage()
    await db_session_manager.init()
    async with db_session_manager.connect() as conn:
        DEFAULT_LOGGER.info("Creating missing database tables and functions...")
        await conn.run_sync(Base.metadata.create_all)
        DEFAULT_LOGGER.info("Installing SQLite full-text search indexes...")
        await initialize_search_index(conn)
    async with get_async_db_session() as session:
        if await session.get(ApplicationSettingsModel, "active_tools") is None:
            await session.execute(
                insert(ApplicationSettingsModel).values(
                    {
                        "key": "active_tools",
                        "value": sorted(set(config.default_allowed_tools) | INTERNAL_TOOL_NAMES),
                    },
                ),
            )
            await session.commit()
    await db_session_manager.close()
    DEFAULT_LOGGER.info("Database initialization complete.")


def arguments() -> argparse.Namespace:
    """Parse CLI arguments for the init_db entry point.

    Returns:
        Namespace with ``reset`` (bool) and ``yes`` (bool).
    """
    parser = argparse.ArgumentParser(description="Initialize the backend database without deleting existing data.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete the selected SQLite database, original files, and knowledge storage; preserve model bundles.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm a scripted reset; never use this with an unverified target.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    options = arguments()
    asyncio.run(initialize_database(reset=options.reset, assume_yes=options.yes))
