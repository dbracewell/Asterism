from typing import Any

from cachetools import TTLCache
from pydantic import JsonValue
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.data import get_async_db_session
from asterism.core.data.models import AppSetting, UserSetting
from asterism.core.data.schemas.settings import (
    ApplicationSettings,
    Setting,
    UserSettings,
)
from asterism.core.utils.atomic import Atomic


class SettingsRepository:
    def __init__(self) -> None:
        self.user_cache: TTLCache[str, UserSettings] = TTLCache(maxsize=100, ttl=3600)
        self.app_cache = Atomic[ApplicationSettings | None](None)

    async def get_user_settings(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> UserSettings:
        cached = self.user_cache.get(user_id)
        if cached:
            return cached

        async with get_async_db_session(session) as session:
            stmt = select(UserSetting).where(UserSetting.user_id == user_id)
            result = await session.scalars(stmt)

            combined = dict()
            for row in result.all():
                combined[row.key] = row.value

            if not combined:
                return UserSettings()

            new_setting = UserSettings.model_validate(combined)
            self.user_cache[user_id] = new_setting
            return new_setting

    async def bulk_upsert_user_settings(
        self,
        user_id: str,
        updates: dict[str, JsonValue],
        session: AsyncSession | None = None,
    ) -> UserSettings:
        async with get_async_db_session(session) as session:
            for key, value in updates.items():
                stmt = (
                    update(UserSetting)
                    .where(
                        UserSetting.user_id == user_id,
                        UserSetting.key == key,
                    )
                    .values({"value": value})
                )
                await session.execute(stmt)
            await session.commit()
            self.user_cache.pop(user_id, None)
        return await self.get_user_settings(user_id, session)

    async def upsert_user_setting(
        self,
        user_id: str,
        key: str,
        value: dict,
        session: AsyncSession | None = None,
    ) -> Setting:
        self.user_cache.pop(user_id, None)
        async with get_async_db_session(session) as session:
            existing = await session.get(UserSetting, (user_id, key))
            if existing:
                existing.value = value
                await session.merge(existing)
                await session.flush()
                await session.commit()
                return Setting(key=existing.key, value=existing.value)  # type: ignore
            new_setting = UserSetting(user_id=user_id, key=key, value=value)
            session.add(new_setting)
            await session.flush()
            await session.refresh(new_setting)
            await session.commit()
            return Setting(key=new_setting.key, value=new_setting.value)

    async def delete_user_setting(
        self,
        user_id: str,
        key: str,
        session: AsyncSession | None = None,
    ) -> None:
        self.user_cache.pop(user_id, None)
        async with get_async_db_session(session) as session:
            setting = await session.get(UserSetting, (user_id, key))
            if setting:
                await session.delete(setting)
                await session.flush()
                await session.commit()

    async def delete_user_all_settings(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> None:
        self.user_cache.pop(user_id, None)
        async with get_async_db_session(session) as session:
            stmt = select(UserSetting).where(UserSetting.user_id == user_id)
            result = await session.execute(stmt)
            for row in result.scalars().all():
                await session.delete(row)
            await session.flush()
            await session.commit()

    # ------------------------------------------------------------------
    # Application settings
    # ------------------------------------------------------------------

    async def get_app_settings(
        self,
        session: AsyncSession | None = None,
    ) -> ApplicationSettings:
        cached = self.app_cache.value
        if cached:
            return cached

        async with get_async_db_session(session) as session:
            stmt = select(AppSetting)
            result = await session.scalars(stmt)

            full: dict[str, Any] = {}
            for row in result.all():
                full[row.key] = row.value

            if not full:
                return ApplicationSettings()

            new_setting = ApplicationSettings.model_validate(full)
            self.app_cache.value = new_setting
            return new_setting

    async def upsert_app_setting(
        self,
        key: str,
        value: JsonValue,
        updated_by: str,
        session: AsyncSession | None = None,
    ) -> Setting:
        self.app_cache.value = None
        async with get_async_db_session(session) as session:
            existing = await session.get(AppSetting, key)
            if existing:
                existing.value = value
                existing.updated_by = updated_by
                session.add(existing)
                await session.flush()
                await session.commit()
                return Setting(key=existing.key, value=existing.value)  # type: ignore
            new_setting = AppSetting(key=key, value=value, updated_by=updated_by)
            session.add(new_setting)
            await session.flush()
            await session.refresh(new_setting)
            await session.commit()
            return Setting(key=new_setting.key, value=new_setting.value)

    async def delete_app_setting(
        self,
        key: str,
        session: AsyncSession | None = None,
    ) -> None:
        async with get_async_db_session(session) as session:
            setting = await session.get(AppSetting, key)
            if setting:
                await session.delete(setting)
                await session.flush()
                await session.commit()

    async def bulk_update_app_setting(
        self,
        updated_by: str,
        updates: dict[str, JsonValue],
        session: AsyncSession | None = None,
    ) -> ApplicationSettings:
        async with get_async_db_session(session) as session:
            for key, value in updates.items():
                stmt = (
                    update(AppSetting)
                    .where(
                        AppSetting.key == key,
                    )
                    .values({"value": value, "updated_by": updated_by})
                )
                await session.execute(stmt)
            await session.commit()
            self.app_cache.value = None
        return await self.get_app_settings(session)


settings_repository = SettingsRepository()
