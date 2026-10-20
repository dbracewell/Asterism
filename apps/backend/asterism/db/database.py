"""Async engine/session lifecycle for the relational database.

Owns the single application-wide :class:`AsyncEngine` and session factory,
created lazily from ``config.db_url``. The SQLite dialect gets per-connection
PRAGMAs (WAL, foreign keys, busy timeout) applied on connect.

Every entry point (:meth:`DatabaseSessionManager.init`,
:func:`get_async_db_session`, the FastAPI dependency in
:mod:`asterism.db.dependencies`) initializes the manager lazily and
idempotently, so callers never need to know whether startup already ran.

Sessions are transactional at the caller: this module never commits. Callers
open a session, do their work, and commit explicitly; the context managers
here only guarantee rollback on exception and always close the resource.
"""

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy import event, make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from asterism.core import config


def set_sqlite_pragma(dbapi_connection, connection_record):
    """Apply per-connection SQLite PRAGMAs on every new raw DBAPI connection.

    Registered on the engine's ``connect`` event (see :meth:`DatabaseSessionManager.init`):

    - ``journal_mode=WAL``: readers do not block writers; also creates the
      ``-wal``/``-shm`` sidecar files that reset tooling must clean up.
    - ``synchronous=NORMAL``: safe with WAL and faster than FULL.
    - ``foreign_keys=ON``: SQLite does not enforce FKs by default.
    - ``busy_timeout=5000``: wait up to 5s on locked databases instead of
      failing immediately.
    - ``cache_size=-64000``: ~64 MB page cache per connection.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA cache_size=-64000")
    cursor.close()


class DatabaseSessionManager:
    """Lazily-initialized holder for the app-wide async engine and session factory.

    Guarded by an :class:`asyncio.Lock` (the app runs on a single event loop);
    ``init`` is idempotent, so it is safe to call from both the FastAPI
    lifespan and from the lazy entry points. ``close`` clears state atomically
    under the same lock before disposing, so a concurrent lazy init cannot
    resurrect an engine that is being torn down — it will create a fresh one.
    """

    def __init__(self) -> None:
        self._engine: AsyncEngine | None = None
        self._session_maker: async_sessionmaker[AsyncSession] | None = None
        self._lock: asyncio.Lock = asyncio.Lock()

    async def init(self):
        """Create the engine and session factory if they do not exist yet.

        Raises:
            RuntimeError: if ``config.db_url`` is empty.
        """
        async with self._lock:
            if not config.db_url:
                raise RuntimeError("Database URL is not set in the configuration")

            if self._engine is None:
                self._engine = create_async_engine(config.db_url)
                url = make_url(config.db_url)
                if url.drivername.startswith("sqlite"):
                    event.listen(
                        self._engine.sync_engine,
                        "connect",
                        set_sqlite_pragma,
                    )
            if self._session_maker is None:
                self._session_maker = async_sessionmaker(
                    expire_on_commit=False,
                    bind=self._engine,
                )

    @property
    def is_initialized(self) -> bool:
        """True once both the engine and session factory exist."""
        return self._engine is not None and self._session_maker is not None

    async def close(self) -> None:
        """Dispose of the engine pool and forget both objects.

        Intended for application shutdown (FastAPI lifespan teardown) and the
        ``init_db`` CLI, which re-create everything on their next run. State is
        cleared under the lock before disposal so a concurrent :meth:`init`
        starts from a clean slate instead of racing the dispose.

        Raises:
            RuntimeError: if the manager was never initialized.
        """
        async with self._lock:
            if self._engine is None:
                raise RuntimeError("DatabaseSessionManager is not initialized")
            engine, self._engine = self._engine, None
            self._session_maker = None
        await engine.dispose()

    @asynccontextmanager
    async def connect(self):
        """Yield a raw connection inside a transaction.

        The transaction commits if the block exits normally and rolls back on
        exception; exiting ``engine.begin()`` owns both, so no explicit
        rollback is needed here.

        Raises:
            RuntimeError: if the manager was never initialized.
        """
        if self._engine is None:
            raise RuntimeError("DatabaseSessionManager is not initialized")

        async with self._engine.begin() as connection:
            yield connection

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession, None]:
        """Yield a new :class:`AsyncSession`; the caller owns committing.

        Rolls back on exception and always closes the session. Objects are
        created with ``expire_on_commit=False``, so attributes remain readable
        after commit without triggering lazy refreshes on a closed session.

        Raises:
            RuntimeError: if the manager was never initialized.
        """
        if self._session_maker is None:
            raise RuntimeError("DatabaseSessionManager is not initialized")

        session = self._session_maker()
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
    """Context manager used by background jobs and non-request code paths.

    Args:
        session: An existing session to reuse as-is (ownership, including
            commit/rollback/close, stays with the caller). When ``None`` a new
            session is opened from :data:`db_session_manager`, initializing it
            lazily if needed.
    """
    if session is not None:
        yield session
    else:
        await db_session_manager.init()
        async with db_session_manager.session() as new_session:
            yield new_session
