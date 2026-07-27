from cachetools import LRUCache, cached
from sqlalchemy import delete, insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.db import get_async_db_session
from asterism.core.models import User


class UserRepository:
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
                return True
            except Exception:
                return False

    @cached(cache=LRUCache(maxsize=100))
    async def user_exists(
        self, user_id: str, session: AsyncSession | None = None
    ) -> bool:
        async with get_async_db_session(session) as session:
            user = await session.get(User, user_id)
            return user is not None

    async def ensure_user(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> None:
        async with get_async_db_session(session) as session:
            user = await self.user_exists(user_id, session)
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
            if self.user_exists.cache:
                self.user_exists.cache.clear()
            return True


user_repository = UserRepository()
