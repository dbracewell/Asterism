"""The admin's local generator choices, stored as one application setting (US-76.2)."""

from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.settings.models import ApplicationSettingsModel

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
    # Written directly (validated by LocalSettings) so the generator doesn't depend on the settings service.
    value = settings.model_dump(mode="json")
    await session.execute(
        insert(ApplicationSettingsModel)
        .values(key=SETTING_KEY, value=value)
        .on_conflict_do_update(index_elements=[ApplicationSettingsModel.key], set_={"value": value})
    )
    await session.commit()
    session.expire_all()
    return await read_settings(session)
