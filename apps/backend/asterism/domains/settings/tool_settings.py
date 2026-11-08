"""Read path for admin tool settings (enabled tools + component providers)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.db.database import get_async_db_session

from .models import ApplicationSettingsModel
from .schemas import ToolSettings
from .secrets import decrypt_component_provider_dict

_TOOL_SETTINGS_KEYS = set(ToolSettings.model_fields)
#: Component-provider setting keys whose JSON values hold encrypted parameters.
COMPONENT_PROVIDER_KEYS = {"web_search_provider", "image_search_provider"}


async def get_tool_settings(
    session: AsyncSession | None = None,
) -> ToolSettings:
    """Load tool settings, decrypting component provider parameters.

    Args:
        session: Existing session to reuse; a new one is opened when omitted.
    """
    async with get_async_db_session(session) as session:
        stmt = select(ApplicationSettingsModel).where(
            ApplicationSettingsModel.key.in_(_TOOL_SETTINGS_KEYS),
        )
        settings = {
            row.key: (decrypt_component_provider_dict(row.value) if row.key in COMPONENT_PROVIDER_KEYS else row.value)
            for row in (await session.scalars(stmt)).all()
        }
        return ToolSettings.model_validate(settings)


async def user_active_tools(user_id: str, session: AsyncSession) -> set[str]:
    """Admin-enabled tools the user's group allows, read live (ADR-0058).

    Internal context-managed tools are not limited by group; their own live
    checks decide them.
    """
    from asterism.domains.groups.service import read_access
    from asterism.domains.tools.catalog import INTERNAL_TOOL_NAMES

    access = await read_access(user_id, session)
    active = (await get_tool_settings(session)).active_tools
    return {name for name in active if name in INTERNAL_TOOL_NAMES or access.allows_tool(name)}
