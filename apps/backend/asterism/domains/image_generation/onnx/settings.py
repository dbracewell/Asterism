"""The admin's ONNX generator choices, stored as one application setting (US-94.4)."""

from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.settings.models import ApplicationSettingsModel

from .schemas import OnnxSettings

SETTING_KEY = "image_generation_onnx"


async def read_settings(session: AsyncSession) -> OnnxSettings:
    row = await session.get(ApplicationSettingsModel, SETTING_KEY)
    try:
        return (
            OnnxSettings.model_validate(row.value)
            if row is not None and isinstance(row.value, dict)
            else OnnxSettings()
        )
    except ValueError:
        return OnnxSettings()


async def write_settings(settings: OnnxSettings, session: AsyncSession) -> OnnxSettings:
    # Written directly (validated by OnnxSettings) so the generator doesn't depend on the settings service.
    value = settings.model_dump(mode="json")
    await session.execute(
        insert(ApplicationSettingsModel)
        .values(key=SETTING_KEY, value=value)
        .on_conflict_do_update(index_elements=[ApplicationSettingsModel.key], set_={"value": value})
    )
    await session.commit()
    session.expire_all()
    return await read_settings(session)
