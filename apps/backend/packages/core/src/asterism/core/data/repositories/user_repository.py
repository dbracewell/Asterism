from sqlalchemy import delete, insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.data import get_async_db_session
from asterism.core.data.models import User
from asterism.core.services.dependencies.db import get_db_session


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

    async def delete_user(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> bool:
        async with get_async_db_session(session) as session:
            stmt = delete(User).where(User.id == user_id)
            await session.execute(stmt)
            await session.commit()
            return True


user_repository = UserRepository()
