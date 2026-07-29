import threading
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from asterism import config


def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA cache_size=-64000")
    cursor.close()


class DatabaseSessionManager:
    def __init__(self) -> None:
        self._engine = None
        self._session_maker = None
        self._lock = threading.Lock()

    def init(self):
        self._lock.acquire()
        try:
            if self._engine is None:
                self._engine = create_async_engine(config.DB_URL)
                event.listen(
                    self._engine.sync_engine, "connect", set_sqlite_pragma
                )
            if self._session_maker is None:
                self._session_maker = async_sessionmaker(
                    expire_on_commit=False,
                    bind=self._engine,
                )
        finally:
            self._lock.release()

    @property
    def is_initialized(self) -> bool:
        self._lock.acquire()
        try:
            return self._engine is not None and self._session_maker is not None
        finally:
            self._lock.release()

    async def close(self) -> None:
        if self._engine is None:
            raise Exception("DatabaseSessionManager is not initialized")
        await self._engine.dispose()
        self._engine = None
        self._session_maker = None

    @asynccontextmanager
    async def connect(self):
        if self._engine is None:
            raise Exception("DatabaseSessionManager is not initialized")

        async with self._engine.begin() as connection:
            try:
                yield connection
            except Exception:
                await connection.rollback()
                raise

    @asynccontextmanager
    async def session(self):
        if self._session_maker is None:
            raise Exception("DatabaseSessionManager is not initialized")

        session = self._session_maker()  # type: ignore
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


db_session_manager = DatabaseSessionManager()


@asynccontextmanager
async def get_async_db_session(
    session: AsyncSession | None = None,
) -> AsyncGenerator[AsyncSession, None]:
    if session is not None:
        yield session
    else:
        db_session_manager.init()
        async with db_session_manager.session() as new_session:
            yield new_session
