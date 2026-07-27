from cachetools import TTLCache
from sqlalchemy import delete, insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.db import get_async_db_session
from asterism.core.models import User


class UserRepository:
    def __init__(self) -> None:
        self.user_cache = TTLCache[str, bool](maxsize=100, ttl=3600)

    async def create_user(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> bool:
        async with get_async_db_session(session) as session:
            try:
                stmt = insert(User).values(id=user_id)
                await session.execute(stmt)
                await session.commit()
                self.user_cache[user_id] = True
                return True
            except Exception:
                self.user_cache[user_id] = False
                return False

    async def user_exists(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> bool:
        exists = self.user_cache.get(user_id)
        if exists:
            return exists
        async with get_async_db_session(session) as session:
            user = await session.get(User, user_id)
            self.user_cache[user_id] = user is not None
            return user is not None

    async def ensure_user(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> None:
        async with get_async_db_session(session) as session:
            user = await self.user_exists(user_id=user_id, session=session)
            if user:
                return
            await self.create_user(user_id, session)

    async def delete_user(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> bool:
        async with get_async_db_session(session) as session:
            stmt = delete(User).where(User.id == user_id)
            await session.execute(stmt)
            await session.commit()
            try:
                self.user_cache.pop(user_id)
            except KeyError:
                # Ignored
                pass
            return True


user_repository = UserRepository()
