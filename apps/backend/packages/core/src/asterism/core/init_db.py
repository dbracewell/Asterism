import asyncio
from pathlib import Path

from asterism.core.config import config
from asterism.core.db import db_session_manager
from asterism.core.models import Base


async def init_database():
    print("Creating database schema...")
    print(config.DB_FILE, config.DB_FILE.exists())
    if config.DB_FILE.exists():
        config.DB_FILE.unlink()
        for ext in ("wal", "shm", "journal"):
            file = Path(f"{config.DB_FILE.resolve()}-{ext}")
            if file.exists():
                file.unlink()

    db_session_manager.init()
    async with db_session_manager.connect() as conn:
        print("Pushing tables and functions...")
        await conn.run_sync(Base.metadata.create_all)
    await db_session_manager.close()
    print("Database initialization complete.")


if __name__ == "__main__":
    asyncio.run(init_database())
