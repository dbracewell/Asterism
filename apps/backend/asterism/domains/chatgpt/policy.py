"""Fail-closed admin policy for ChatGPT plan usage (default disabled).

Reads and writes the ``chatgpt_plan_enabled`` application-settings row through
the settings model only, so availability checks inside the settings service
can read the policy without an import cycle.
"""

from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.settings.models import ApplicationSettingsModel

from .schemas import ChatGPTPolicy

POLICY_KEY = "chatgpt_plan_enabled"


async def read_policy(session: AsyncSession) -> ChatGPTPolicy:
    row = await session.get(ApplicationSettingsModel, POLICY_KEY, populate_existing=True)
    # Malformed direct writes cannot turn a policy on through truthiness.
    return ChatGPTPolicy(enabled=row is not None and row.value is True)


async def write_policy(payload: ChatGPTPolicy, session: AsyncSession) -> ChatGPTPolicy:
    await session.execute(
        insert(ApplicationSettingsModel)
        .values(key=POLICY_KEY, value=payload.enabled)
        .on_conflict_do_update(index_elements=[ApplicationSettingsModel.key], set_={"value": payload.enabled}),
    )
    await session.commit()
    return await read_policy(session)
