from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.db import db_session_manager


async def get_db_session():
    async with db_session_manager.session() as session:
        yield session


type DBSessionDep = Annotated[AsyncSession, Depends(get_db_session)]
