import uuid

from cachetools import TTLCache
from sqlalchemy import delete, insert
from sqlalchemy.ext.asyncio import AsyncSession

import asterism.domains.agent.service as agents_service
import asterism.domains.settings.service as settings_service
from asterism.db.database import get_async_db_session
from asterism.domains.agent.schemas import PartialAgentProfile
from asterism.domains.settings.schemas import Provider
from asterism.domains.user.models import UserModel


def get_first_model_id(providers: list[Provider]) -> uuid.UUID | None:
    for provider in providers:
        for model in provider.models:
            if model.is_active:
                return model.id
    return None


_user_cache = TTLCache[str, bool](maxsize=100, ttl=3600)


async def create_user(
    user_id: str,
    session: AsyncSession | None = None,
) -> bool:
    async with get_async_db_session(session) as session:
        try:
            stmt = insert(UserModel).values(id=user_id)
            await session.execute(stmt)
            await session.commit()
            _user_cache[user_id] = True
            await initialize_user_settings(user_id=user_id, session=session)
            return True
        except Exception:
            _user_cache[user_id] = False
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
    user_settings = await settings_service.get_user_settings(
        user_id=user_id,
        session=session,
    )

    # User already has a default model id and default agent id
    # so nothing needs to be done
    if user_settings.default_model_id and user_settings.default_agent_id:
        return

    # User does not have a default agent, but does have agents defined
    # go ahead and return
    if user_settings.default_agent_id is None and len(user_settings.agents) > 0:
        return

    app_settings = await settings_service.get_app_settings(session=session)

    # User does not have any agents defined so try and create
    # a default agent if possible

    default_model_id = user_settings.default_model_id
    if not user_settings.default_model_id:
        default_model_id = get_first_model_id(app_settings.llm_providers or [])

    if not default_model_id:
        # No model defined cannot do anything
        return

    new_profile = await agents_service.upsert_agent_profile(
        user_id=user_id,
        agent_profile=PartialAgentProfile.create_default_agent(
            model_id=default_model_id,
        ),
        session=session,
    )

    await settings_service.bulk_upsert_user_settings(
        user_id=user_id,
        session=session,
        updates={
            "default_model_id": str(default_model_id),
            "default_agent_id": str(new_profile.id),
        },
    )


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
