"""ComfyUI settings, stored as one application setting with the token encrypted (US-76.3).

The key is not part of the generic application settings aggregate, so the
token is only ever written and read through these functions.
"""

from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.secrets import decrypt_secret, encrypt_secret

from .schemas import ComfyUISettings, ComfyUISettingsUpdate, ComfyUISettingsView

SETTING_KEY = "image_generation_comfyui"


async def read_settings(session: AsyncSession) -> ComfyUISettings:
    row = await session.get(ApplicationSettingsModel, SETTING_KEY)
    if row is None or not isinstance(row.value, dict):
        return ComfyUISettings()
    try:
        stored = ComfyUISettings.model_validate(row.value)
    except ValueError:
        return ComfyUISettings()
    return stored.model_copy(update={"token": decrypt_secret(stored.token)})


def merge(update: ComfyUISettingsUpdate, current: ComfyUISettings) -> ComfyUISettings:
    values = update.model_dump(exclude={"token"})
    return ComfyUISettings(**values, token=current.token if update.token is None else update.token)


async def write_settings(settings: ComfyUISettings, session: AsyncSession) -> ComfyUISettings:
    value = settings.model_copy(update={"token": encrypt_secret(settings.token)}).model_dump(mode="json")
    await session.execute(
        insert(ApplicationSettingsModel)
        .values(key=SETTING_KEY, value=value)
        .on_conflict_do_update(index_elements=[ApplicationSettingsModel.key], set_={"value": value})
    )
    await session.commit()
    session.expire_all()
    return await read_settings(session)


def view(settings: ComfyUISettings) -> ComfyUISettingsView:
    return ComfyUISettingsView(**settings.model_dump(exclude={"token"}), has_token=bool(settings.token))
