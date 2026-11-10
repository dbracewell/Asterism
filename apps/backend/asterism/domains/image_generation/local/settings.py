"""The admin's local generator choices, stored as one application setting (US-76.2)."""

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.service import upsert_app_setting

from .schemas import LocalSettings

SETTING_KEY = "image_generation_local"


async def read_settings(session: AsyncSession) -> LocalSettings:
    row = await session.get(ApplicationSettingsModel, SETTING_KEY)
    try:
        return (
            LocalSettings.model_validate(row.value)
            if row is not None and isinstance(row.value, dict)
            else LocalSettings()
        )
    except ValueError:
        return LocalSettings()


async def write_settings(settings: LocalSettings, session: AsyncSession) -> LocalSettings:
    await upsert_app_setting(SETTING_KEY, settings.model_dump(mode="json"), session=session)
    return await read_settings(session)
