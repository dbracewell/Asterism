"""Per-user settings: read, validate, upsert and delete (the ``user_settings`` table)."""

import uuid
from typing import Any, get_args

from pydantic import JsonValue
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException
from asterism.db.database import get_async_db_session

from .models import (
    UserSettingModel,
)
from .providers import get_user_models
from .schemas import (
    FIRST_CHAT_TOUR_SETTING,
    FirstChatTourState,
    Setting,
    UserSettings,
)

# The sizes Settings offers (the frontend's FONT_SIZES, US-116.2).
FONT_SIZES = ("12px", "14px", "16px", "18px", "20px")


async def get_user_settings(
    user_id: str,
    session: AsyncSession | None = None,
) -> UserSettings:
    """Assemble one user's full settings aggregate.

    Merges the JSON key/value rows with the agent domain's main-agent and
    sub-agent records, then attaches the list of all active models.
    """
    import asterism.domains.agent.service as agent_service

    async with get_async_db_session(session) as session:
        stmt = select(UserSettingModel).where(UserSettingModel.user_id == user_id)
        result = await session.scalars(stmt)
        combined: dict[str, Any] = {row.key: row.value for row in result.all()}

        combined["main_agent"] = await agent_service.get_main_agent(user_id, session)
        combined["sub_agents"] = {agent.id: agent for agent in await agent_service.get_sub_agents(user_id, session)}
        user_settings = UserSettings.model_validate(combined)
        user_settings.models = await get_user_models(user_id, session=session)
        from asterism.domains.groups.service import read_group_refs

        user_settings.group = (await read_group_refs([user_id], session)).get(user_id)

    return user_settings


async def get_user_setting(
    user_id: str,
    key: str,
    session: AsyncSession | None = None,
) -> JsonValue | None:
    """One stored user setting value, or ``None`` when the key is unset."""
    async with get_async_db_session(session) as session:
        return await session.scalar(
            select(UserSettingModel.value).where(UserSettingModel.user_id == user_id, UserSettingModel.key == key),
        )


async def bulk_upsert_user_settings(
    user_id: str,
    updates: dict[str, Any],
    session: AsyncSession | None = None,
) -> UserSettings:
    """Validate then upsert several user settings atomically; returns the refreshed aggregate.

    A ``None`` value deletes that key instead of writing it.
    """
    async with get_async_db_session(session) as session:
        for key, value in updates.items():
            await _validate_user_setting(user_id, key, value, session)

        for key, value in updates.items():
            if value is None:
                stmt = delete(UserSettingModel).where(
                    UserSettingModel.user_id == user_id,
                    UserSettingModel.key == key,
                )
            else:
                stmt = (
                    insert(UserSettingModel)
                    .values(
                        {
                            "user_id": user_id,
                            "value": value,
                            "key": key,
                        },
                    )
                    .on_conflict_do_update(
                        index_elements=["user_id", "key"],
                        set_={
                            "value": value,
                        },
                    )
                )

            await session.execute(stmt)

        await session.commit()

    return await get_user_settings(user_id, session)


async def upsert_user_setting(
    user_id: str,
    key: str,
    value: JsonValue,
    session: AsyncSession | None = None,
) -> Setting:
    """Set one user setting (a ``None`` value deletes it); validates key and value shape."""

    if value is None:
        await delete_user_setting(user_id, key, session)
        return Setting(key=key, value=value)

    async with get_async_db_session(session) as session:
        await _validate_user_setting(user_id, key, value, session)
        stmt = (
            insert(UserSettingModel)
            .values(
                {
                    "user_id": user_id,
                    "value": value,
                    "key": key,
                },
            )
            .on_conflict_do_update(
                index_elements=["user_id", "key"],
                set_={
                    "value": value,
                },
            )
        )
        await session.execute(stmt)
        await session.commit()

        return Setting(key=key, value=value)


async def delete_user_setting(
    user_id: str,
    key: str,
    session: AsyncSession | None = None,
) -> None:
    """Delete one user setting row; the key must be a known, deletable setting."""
    async with get_async_db_session(session) as session:
        await _validate_user_setting(user_id, key, None, session)
        stmt = delete(UserSettingModel).where(
            UserSettingModel.user_id == user_id,
            UserSettingModel.key == key,
        )
        await session.execute(stmt)
        await session.commit()


async def _validate_user_setting(user_id: str, key: str, value: Any, session: AsyncSession) -> None:
    """Enforce the whitelist of user setting keys and per-key value shapes.

    ``default_model_id`` must reference an existing, active model; ``None``
    values (deletes) skip shape checks.
    """
    if key not in {
        "theme",
        "font_size",
        "default_model_id",
        "show_thinking",
        "prompt_coach_enabled",
        "canvas_enabled",
        "memory_enabled",
        FIRST_CHAT_TOUR_SETTING,
    }:
        raise BadDataException("Unsupported user setting")
    if value is not None and key == "default_model_id":
        try:
            model_id = uuid.UUID(str(value))
        except ValueError as exc:
            raise BadDataException("default_model_id must be a model UUID") from exc
        from asterism.domains.chatgpt.availability import available_user_model

        if await available_user_model(user_id, model_id, session) is None:
            raise BadDataException("Default model must be available and active")
    if (
        value is not None
        and key in {"show_thinking", "prompt_coach_enabled", "canvas_enabled", "memory_enabled"}
        and not isinstance(value, bool)
    ):
        raise BadDataException(f"{key} must be boolean")
    if value is not None and key in {"theme", "font_size"} and not isinstance(value, str):
        raise BadDataException(f"{key} must be text")
    if value is not None and key == "font_size" and value not in FONT_SIZES:
        raise BadDataException(f"font_size must be one of: {', '.join(FONT_SIZES)}")
    if value is not None and key == FIRST_CHAT_TOUR_SETTING and value not in get_args(FirstChatTourState):
        raise BadDataException(f"{key} must be one of: completed, dismissed")
