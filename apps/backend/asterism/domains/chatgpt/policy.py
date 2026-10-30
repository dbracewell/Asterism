"""Fail-closed admin policy for ChatGPT plan usage (default disabled)."""

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.service import upsert_app_setting

from .schemas import ChatGPTPolicy

POLICY_KEY = "chatgpt_plan_enabled"


async def read_policy(session: AsyncSession) -> ChatGPTPolicy:
    row = await session.get(ApplicationSettingsModel, POLICY_KEY)
    # Malformed direct writes cannot turn a policy on through truthiness.
    return ChatGPTPolicy(enabled=row is not None and row.value is True)


async def write_policy(payload: ChatGPTPolicy, session: AsyncSession) -> ChatGPTPolicy:
    await upsert_app_setting(POLICY_KEY, payload.enabled, session=session)
    return await read_policy(session)
