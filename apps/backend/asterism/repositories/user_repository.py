import uuid

from cachetools import TTLCache
from sqlalchemy import delete, insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.db import get_async_db_session
from asterism.models import User
from asterism.schemas import LLMProvider, PartialAgentProfile


def get_first_model_id(providers: list[LLMProvider]) -> uuid.UUID | None:
    print(providers)
    for provider in providers:
        for model in provider.models:
            if model.is_active:
                return model.id
    return None


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
                await self.initialize_user_settings(user_id=user_id, session=session)
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
                await self.initialize_user_settings(
                    user_id=user_id,
                    session=session,
                )
                return
            await self.create_user(user_id, session)

    async def initialize_user_settings(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> None:
        from .agent_repository import agent_repository
        from .settings_repository import settings_repository

        user_settings = await settings_repository.get_user_settings(
            user_id=user_id,
            session=session,
        )
        if user_settings.default_model_id and user_settings.default_agent_id:
            return

        app_settings = await settings_repository.get_app_settings(session=session)

        user_initial_settings = {}
        default_model_id = user_settings.default_model_id
        if not user_settings.default_model_id:
            default_model_id = get_first_model_id(app_settings.llm_providers or [])
            if default_model_id:
                user_initial_settings["default_model_id"] = str(default_model_id)

        if default_model_id:
            new_profile = PartialAgentProfile(
                user_id=user_id,
                model_id=default_model_id,
                max_steps=5,
                description="A default agent to answer the user's requests",
                name="Default agent",
                system_prompt=(
                    "You are a helpful agent here to assist "
                    "the user in their information needs."
                ),
            )
            new_profile = await agent_repository.upsert_agent_profile(
                new_profile,
                session=session,
            )
            user_initial_settings["default_agent_id"] = str(new_profile.id)

        if len(user_initial_settings) > 0:
            await settings_repository.bulk_upsert_user_settings(
                user_id=user_id,
                session=session,
                updates=user_initial_settings,
            )

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
