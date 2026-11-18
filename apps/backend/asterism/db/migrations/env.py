"""Alembic environment for the backend database (``database.db``).

Two ways in:

- :mod:`asterism.db.migrate` (``init_db``, startup checks, tests) opens its own
  connection and passes it as ``config.attributes["connection"]``.
- The ``alembic`` CLI (``uv run alembic revision --autogenerate -m ...``) gets
  no connection; this module then connects to ``config.db_url`` itself.

Migrations run without the application's per-connection PRAGMAs, so SQLite
foreign keys are off while a migration rebuilds tables (Alembic batch mode).
"""

import asyncio

from alembic import context
from asterism.core import config as app_config
from asterism.db.migrate import AUTOGENERATE_OPTIONS
from asterism.db.model_registry import Base
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

target_metadata = Base.metadata


def _run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,
        **AUTOGENERATE_OPTIONS,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_with_own_engine() -> None:
    if not app_config.db_url:
        raise RuntimeError("Database URL is not set in the configuration")
    engine = create_async_engine(app_config.db_url)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_run)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    raise RuntimeError("Offline (SQL script) migrations are not supported")

provided = context.config.attributes.get("connection")
if provided is not None:
    _run(provided)
else:
    asyncio.run(_run_with_own_engine())
