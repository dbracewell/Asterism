from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.db.database import get_async_db_session

from .models import ApplicationSettingsModel
from .schemas import ToolSettings
from .secrets import decrypt_component_provider_dict

_TOOL_SETTINGS_KEYS = set(ToolSettings.model_fields)
_COMPONENT_PROVIDER_KEYS = {"web_search_provider", "image_search_provider"}


async def get_tool_settings(
    session: AsyncSession | None = None,
) -> ToolSettings:
    async with get_async_db_session(session) as session:
        stmt = select(ApplicationSettingsModel).where(
            ApplicationSettingsModel.key.in_(_TOOL_SETTINGS_KEYS),
        )
        settings = {
            row.key: (decrypt_component_provider_dict(row.value) if row.key in _COMPONENT_PROVIDER_KEYS else row.value)
            for row in (await session.scalars(stmt)).all()
        }
        return ToolSettings.model_validate(settings)
