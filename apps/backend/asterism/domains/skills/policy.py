"""Fail-closed admin policy, separate from private document ownership."""

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.service import upsert_app_setting

from .schemas import SkillPolicy


async def read_policy(session: AsyncSession) -> SkillPolicy:
    row = await session.get(ApplicationSettingsModel, "skills_enabled")
    # Malformed direct writes cannot turn a policy on through truthiness.
    return SkillPolicy(enabled=row is not None and row.value is True)


async def write_policy(payload: SkillPolicy, session: AsyncSession) -> SkillPolicy:
    await upsert_app_setting("skills_enabled", payload.enabled, session=session)
    return await read_policy(session)
