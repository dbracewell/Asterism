"""FastAPI dependency for injecting an :class:`AsyncSession` into route handlers."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .database import db_session_manager


async def get_db_session():
    """Yield a fresh session per request.

    Like :func:`asterism.db.database.get_async_db_session`, this initializes
    :data:`db_session_manager` lazily, so behavior is identical whether or not
    the app lifespan has already run (e.g. in tests). The caller (service
    layer) owns committing; the context manager only rolls back on exception
    and closes the session when the response is done.
    """
    await db_session_manager.init()
    async with db_session_manager.session() as session:
        yield session


# Type alias for annotating endpoint parameters, e.g.
# ``def handler(db: DBSessionDep) -> ...``
type DBSessionDep = Annotated[AsyncSession, Depends(get_db_session)]
