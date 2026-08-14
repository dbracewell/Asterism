import asyncio
from pathlib import Path

from asterism.common.log import DEFAULT_LOGGER
from asterism.core import config

from .base import Base
from .database import db_session_manager


def delete_db():
    db_url = config.db_url or ""

    if not db_url.startswith("sqlite"):
        DEFAULT_LOGGER.warning("Database is not SQLite, skipping file removal.")
        return

    db_file = Path(db_url.split("///")[-1]).resolve()
    if db_file.exists():
        DEFAULT_LOGGER.info("Database file exists, removing it...")
        db_file.unlink()
        for ext in ("wal", "shm", "journal"):
            file = Path(f"{db_file}-{ext}")
            if file.exists():
                file.unlink()


async def init_database():
    DEFAULT_LOGGER.info("Creating database schema...")
    delete_db()
    db_session_manager.init()
    async with db_session_manager.connect() as conn:
        DEFAULT_LOGGER.info("Pushing tables and functions...")
        await conn.run_sync(Base.metadata.create_all)
    await db_session_manager.close()
    DEFAULT_LOGGER.info("Database initialization complete.")


if __name__ == "__main__":
    asyncio.run(init_database())
