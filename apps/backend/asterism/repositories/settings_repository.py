import uuid
from typing import Any, cast

from cachetools import TTLCache
from pydantic import JsonValue
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from asterism.common import Atomic
from asterism.common.exceptions import NotFoundException
from asterism.db import get_async_db_session
from asterism.events import Event, EventType, event_bus
from asterism.models import AppSetting, LLMModelDB, Provider, UserSetting
from asterism.schemas import (
    ApplicationSettingsModel,
    BulkUpdateSettingRequest,
    Setting,
    UserSettingsModel,
)
from asterism.schemas.provider import (
    LLMModel,
    LLMModelInfo,
    LLMModelWithProvider,
    LLMProvider,
)
from asterism.utils.log import get_logger

logger = get_logger("Settings")


class SettingsRepository:
    def __init__(self) -> None:
        self.user_cache: TTLCache[str, UserSettingsModel] = TTLCache[
            str, UserSettingsModel
        ](maxsize=100, ttl=3600)
        self.app_cache = Atomic[ApplicationSettingsModel | None](None)

    # ------------------------------------------------------------------
    # User settings
    # ------------------------------------------------------------------

    async def get_user_settings(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> UserSettingsModel:
        cached = self.user_cache.get(user_id)
        if cached:
            return cached

        async with get_async_db_session(session) as session:
            # Gather all the settings from the database for this user
            # and construct a settings model
            stmt = select(UserSetting).where(UserSetting.user_id == user_id)
            result = await session.scalars(stmt)
            combined: dict[str, Any] = {row.key: row.value for row in result.all()}

            user_settings = UserSettingsModel.model_validate(combined)
            user_settings.models = await self.get_user_models(
                user_id=user_id,
                session=session,
            )

            self.user_cache[user_id] = user_settings

            return user_settings

    async def bulk_upsert_user_settings(
        self,
        user_id: str,
        updates: dict[str, JsonValue],
        session: AsyncSession | None = None,
    ) -> UserSettingsModel:
        async with get_async_db_session(session) as session:
            for key, value in updates.items():
                stmt = (
                    insert(UserSetting)
                    .values(
                        {
                            "user_id": user_id,
                            "value": value,
                            "key": key,
                        }
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
                await session.commit()
                self.user_cache.pop(user_id, None)
                return Setting(key=existing.key, value=existing.value)

            new_setting = UserSetting(user_id=user_id, key=key, value=value)
            session.add(new_setting)
            await session.commit()
            await session.refresh(new_setting)
            self.user_cache.pop(user_id, None)
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
            if not setting:
                raise NotFoundException()

            await session.delete(setting)
            await session.commit()
            self.user_cache.pop(user_id, None)

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

            new_setting = ApplicationSettingsModel.model_validate(full)
            new_setting.llm_providers = [
                LLMProvider.model_validate(p)
                for p in await self.get_all_providers(session)
            ]

            self.app_cache.value = new_setting
            return new_setting

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
                await session.commit()
                self.app_cache.value = None
                self.user_cache.clear()
                return Setting(key=existing.key, value=existing.value)

            new_setting = AppSetting(key=key, value=value, updated_by="admin")
            session.add(new_setting)
            await session.commit()
            await session.refresh(new_setting)
            self.app_cache.value = None
            self.user_cache.clear()
            return Setting(key=new_setting.key, value=new_setting.value)

    async def delete_app_setting(
        self,
        key: str,
        session: AsyncSession | None = None,
    ) -> None:
        async with get_async_db_session(session) as session:
            setting = await session.get(AppSetting, key)
            if not setting:
                raise NotFoundException()

            await session.delete(setting)
            await session.flush()
            await session.commit()
            self.app_cache.value = None
            self.user_cache.clear()

    async def bulk_update_app_setting(
        self,
        updates: BulkUpdateSettingRequest,
        session: AsyncSession | None = None,
    ) -> ApplicationSettingsModel:
        async with get_async_db_session(session) as session:
            llm_providers: list[LLMProvider] | None = None
            for key, value in updates.values.items():
                if key == "llm_providers":
                    """Update the llm providers"""
                    if value:
                        llm_providers = [
                            LLMProvider(**d)  # type: ignore
                            for d in value  # type: ignore
                        ]
                    else:
                        llm_providers = []
                    continue

                if key == "draft_model_id":
                    """Send a signal that the draft model has been updated"""
                    event_bus.emit(Event(type=EventType.DRAFT_MODEL_UPDATED))

                stmt = (
                    insert(AppSetting)
                    .values(
                        {
                            "value": value,
                            "key": key,
                        }
                    )
                    .on_conflict_do_update(
                        index_elements=["key"],
                        set_={
                            "value": value,
                        },
                    )
                )
                await session.execute(stmt)

            if llm_providers is not None:
                await self._bulk_upsert_providers(
                    llm_providers,
                    session=session,
                )

            await session.commit()
            self.app_cache.value = None
            self.user_cache.clear()

        return await self.get_app_settings(session)

    # ------------------------------------------------------------------
    # Provider & Model settings
    # ------------------------------------------------------------------

    async def get_draft_model(
        self,
        session: AsyncSession | None = None,
    ) -> LLMModelWithProvider:
        async with get_async_db_session(session) as session:
            stmt = select(AppSetting.value).where(AppSetting.key == "draft_model_id")

            value = await session.scalar(stmt)
            if not value:
                raise NotFoundException()

            draft_model_id = uuid.UUID(cast(str, value))

            stmt = (
                select(LLMModelDB)
                .options(joinedload(LLMModelDB.provider))
                .where(LLMModelDB.id == draft_model_id)
            )

            result = await session.scalar(stmt)
            if not result:
                raise NotFoundException()

            return LLMModelWithProvider.model_validate(result)

    async def get_all_providers(self, session: AsyncSession) -> list[Provider]:
        async with get_async_db_session(session) as session:
            stmt = select(Provider).options(
                selectinload(Provider.models),
            )
            result = await session.scalars(stmt)
            return list(result.all())

    async def get_user_models(
        self,
        user_id: str,
        session: AsyncSession | None = None,
    ) -> list[LLMModelInfo]:
        async with get_async_db_session(session) as session:
            stmt = (
                select(LLMModelDB)
                .where(
                    LLMModelDB.is_active,
                )
                .options(joinedload(LLMModelDB.provider))
            )
            result = await session.scalars(stmt)
            models: list[LLMModelInfo] = []
            for m in result.all():
                models.append(
                    LLMModelInfo(
                        id=m.id,
                        name=m.name,
                        provider_id=m.provider.id,
                        provider_name=m.provider.name,
                    )
                )
            return models

    async def get_model_and_provider(
        self,
        model_id: uuid.UUID,
        user_id: str | None = None,
        session: AsyncSession | None = None,
    ) -> LLMModelWithProvider:
        async with get_async_db_session(session) as session:
            stmt = (
                select(LLMModelDB)
                .where(
                    LLMModelDB.id == model_id,
                    LLMModelDB.is_active,
                )
                .options(joinedload(LLMModelDB.provider))
            )
            result = await session.scalar(stmt)
            if not result:
                raise NotFoundException()
            return LLMModelWithProvider.model_validate(result)

    async def get_model(
        self,
        model_id: uuid.UUID,
        user_id: str | None = None,
        session: AsyncSession | None = None,
    ) -> LLMModel:
        async with get_async_db_session(session) as session:
            stmt = select(LLMModelDB).where(
                LLMModelDB.id == model_id,
                LLMModelDB.is_active,
            )
            result = await session.scalar(stmt)
            if not result:
                raise NotFoundException()
            return LLMModel.model_validate(result)

    async def _bulk_upsert_providers(
        self,
        update: list[LLMProvider],
        session: AsyncSession,
    ):

        current_providers = await self.get_all_providers(session=session)
        processed_providers = set()
        existing_providers = {p.id: p for p in current_providers}
        for provider in update:
            existing_provider = existing_providers.get(provider.id, None)
            if existing_provider:
                processed_providers.add(provider.id)
                existing_provider.base_url = provider.base_url
                existing_provider.api_key = provider.api_key
                existing_provider.name = provider.name
                existing_provider.models = self._merge_models(
                    provider.models,
                    existing_provider.models,
                )
                await session.flush()
            else:
                processed_providers.add(provider.id)
                new_provider = Provider(
                    id=provider.id,
                    name=provider.name,
                    base_url=provider.base_url,
                    api_key=provider.api_key,
                    models=[
                        LLMModelDB(id=m.id, name=m.name, is_active=m.is_active)
                        for m in provider.models
                    ],
                )
                session.add(new_provider)
                await session.flush()

        for delete_id in set(existing_providers.keys()).difference(processed_providers):
            await session.execute(delete(Provider).where(Provider.id == delete_id))

        event_bus.emit(Event(type=EventType.DRAFT_MODEL_UPDATED))

    def _merge_models(self, new_models: list[LLMModel], existing: list[LLMModelDB]):
        existing_models_by_name = {m.name: m for m in existing}
        synced_models: list[LLMModelDB] = []
        for m_data in new_models:
            if m_data.name in existing_models_by_name:
                existing_model = existing_models_by_name[m_data.name]
                existing_model.is_active = m_data.is_active
                synced_models.append(existing_model)
            else:
                new_model = LLMModelDB(
                    name=m_data.name,
                    is_active=m_data.is_active,
                )
                synced_models.append(new_model)
        return synced_models


settings_repository = SettingsRepository()
