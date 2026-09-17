import argparse
import asyncio
import sys
from pathlib import Path

from sqlalchemy import insert
from sqlalchemy.engine import make_url

from asterism.common.log import DEFAULT_LOGGER
from asterism.core import config
from asterism.domains.settings.models import ApplicationSettingsModel

from .base import Base
from .database import db_session_manager, get_async_db_session


def sqlite_database_path() -> Path:
    url = make_url(config.db_url or "")
    if not url.drivername.startswith("sqlite") or not url.database:
        raise RuntimeError("Database reset supports only a local SQLite target")
    path = Path(url.database)
    if not path.is_absolute():
        raise RuntimeError("Database reset requires an absolute SQLite path")
    return path.resolve()


def delete_database_files(path: Path) -> None:
    for candidate in (
        path,
        *(Path(f"{path}-{ext}") for ext in ("wal", "shm", "journal")),
    ):
        if candidate.exists():
            candidate.unlink()


def confirmed_reset(path: Path, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        return False
    print(f"Backend database selected for deletion: {path}")
    return input("Type RESET to continue: ") == "RESET"


async def initialize_database(*, reset: bool = False, assume_yes: bool = False) -> None:
    config.validate_runtime()
    if reset:
        database_path = sqlite_database_path()
        if not confirmed_reset(database_path, assume_yes):
            raise RuntimeError("Database reset canceled; no files were deleted")
        DEFAULT_LOGGER.warning("Deleting the selected backend SQLite database")
        delete_database_files(database_path)

    config.prepare_storage()
    db_session_manager.init()
    async with db_session_manager.connect() as conn:
        DEFAULT_LOGGER.info("Creating missing database tables and functions...")
        await conn.run_sync(Base.metadata.create_all)
    async with get_async_db_session() as session:
        if await session.get(ApplicationSettingsModel, "active_tools") is None:
            await session.execute(
                insert(ApplicationSettingsModel).values(
                    {
                        "key": "active_tools",
                        "value": config.default_allowed_tools,
                    }
                )
            )
            await session.commit()
    await db_session_manager.close()
    DEFAULT_LOGGER.info("Database initialization complete.")


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Initialize the backend database without deleting existing data."
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete the selected local SQLite database before initialization.",
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
