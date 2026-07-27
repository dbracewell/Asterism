from typing import Any

from cachetools import TTLCache
from pydantic import JsonValue
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.db import get_async_db_session
from asterism.core.models import AppSetting, UserSetting
from asterism.core.models.app_settings import ApplicationSettingsModel
from asterism.core.models.user_settings import UserSettingsModel
from asterism.core.services.schemas.settings import (
    Setting,
)
from asterism.core.utils.atomic import Atomic


class SettingsRepository:
    def __init__(self) -> None:
        self.user_cache = TTLCache[str, UserSettingsModel](
            maxsize=100, ttl=3600
        )
        self.app_cache = Atomic[ApplicationSettingsModel | None](None)

    async def get_user_settings(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> UserSettingsModel:
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
                return UserSettingsModel()

            new_setting = UserSettingsModel.model_validate(combined)
            self.user_cache[user_id] = new_setting
            return new_setting

    async def bulk_upsert_user_settings(
        self,
        user_id: str,
        updates: dict[str, JsonValue],
        session: AsyncSession | None = None,
    ) -> UserSettingsModel:
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
        value: JsonValue,
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
    ) -> ApplicationSettingsModel:
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
                return ApplicationSettingsModel()

            new_setting = ApplicationSettingsModel.model_validate(full)
            self.app_cache.value = new_setting
            return new_setting

    async def get_app_settings_by_prefix(
        self,
        prefix: str,
        session: AsyncSession | None = None,
    ) -> list[Setting]:
        return_settings: list[Setting] = []
        async with get_async_db_session(session) as session:
            stmt = select(AppSetting).where(AppSetting.key.startswith(prefix))
            result = await session.scalars(stmt)
            for s in result.all():
                return_settings.append(Setting(key=s.key, value=s.value))
        return return_settings

    async def get_settings(
        self,
        setting_names: list[str],
        session: AsyncSession | None = None,
    ) -> dict[str, Any]:
        return_settings: dict[str, Any] = {}
        async with get_async_db_session(session) as session:
            stmt = select(AppSetting).where(AppSetting.key.in_(setting_names))
            result = await session.scalars(stmt)
            for s in result.all():
                return_settings[s.key] = s.value
        return return_settings

    async def upsert_app_setting(
        self,
        key: str,
        value: JsonValue,
        session: AsyncSession | None = None,
    ) -> Setting:
        self.app_cache.value = None
        async with get_async_db_session(session) as session:
            existing = await session.get(AppSetting, key)
            if existing:
                existing.value = value
                existing.updated_by = "admin"
                session.add(existing)
                await session.flush()
                await session.commit()
                return Setting(key=existing.key, value=existing.value)  # type: ignore
            new_setting = AppSetting(key=key, value=value, updated_by="admin")
            session.add(new_setting)
            await session.commit()
            await session.refresh(new_setting)
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
    ) -> ApplicationSettingsModel:
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
