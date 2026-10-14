from cachetools import TTLCache
from sqlalchemy import delete, insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.db.database import get_async_db_session
from asterism.domains.agent.service import provision_main_agent
from asterism.domains.user.models import UserModel

_user_cache = TTLCache[str, bool](maxsize=100, ttl=3600)


async def create_user(
    user_id: str,
    session: AsyncSession | None = None,
) -> bool:
    async with get_async_db_session(session) as session:
        try:
            stmt = insert(UserModel).values(id=user_id)
            await session.execute(stmt)
            await provision_main_agent(user_id, session)
            await session.commit()
            _user_cache[user_id] = True
            return True
        except IntegrityError:
            await session.rollback()
            if await session.get(UserModel, user_id) is None:
                raise
            await initialize_user_settings(user_id, session)
            _user_cache[user_id] = True
            return False


async def user_exists(
    user_id: str,
    session: AsyncSession | None = None,
) -> bool:
    exists = _user_cache.get(user_id)
    if exists:
        return exists
    async with get_async_db_session(session) as session:
        user = await session.get(UserModel, user_id)
        _user_cache[user_id] = user is not None
        return user is not None


async def ensure_user(
    user_id: str,
    session: AsyncSession | None = None,
) -> None:
    async with get_async_db_session(session) as session:
        user = await user_exists(user_id=user_id, session=session)
        if user:
            await initialize_user_settings(
                user_id=user_id,
                session=session,
            )
            return
        await create_user(user_id, session)


async def initialize_user_settings(
    user_id: str,
    session: AsyncSession | None = None,
) -> None:
    async with get_async_db_session(session) as session:
        await provision_main_agent(user_id, session)
        await session.commit()


async def delete_user(
    user_id: str,
    session: AsyncSession | None = None,
) -> bool:
    async with get_async_db_session(session) as session:
        stmt = delete(UserModel).where(UserModel.id == user_id)
        await session.execute(stmt)
        await session.commit()
        _user_cache.pop(user_id, None)
        return True
