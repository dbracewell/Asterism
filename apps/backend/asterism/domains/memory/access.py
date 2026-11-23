"""The admin's memory switches, read live: the policy and the person's group (ADR-0078).

Kept free of the courses and chat domains, so the settings service can report
``memory_allowed`` without an import cycle.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.settings.models import ApplicationSettingsModel

from .schemas import MemoryAvailability, MemoryPolicy, MemorySwitch

POLICY_KEY = "memory"


async def read_policy(session: AsyncSession) -> MemoryPolicy:
    row = await session.get(ApplicationSettingsModel, POLICY_KEY)
    if row is None or not isinstance(row.value, dict):
        return MemoryPolicy()
    try:
        return MemoryPolicy.model_validate(row.value)
    except ValueError:
        # A malformed direct write never turns memory on.
        return MemoryPolicy()


async def memory_allowed(user_id: str, session: AsyncSession) -> MemoryAvailability:
    """The admin's switches alone: the policy and the person's group."""
    from asterism.domains.groups.service import read_group_id

    policy = await read_policy(session)
    if not policy.enabled:
        return MemoryAvailability(
            available=False, off_by=MemorySwitch.POLICY, reason="Your administrator has turned memory off"
        )
    if policy.group_ids is not None and await read_group_id(user_id, session) not in policy.group_ids:
        return MemoryAvailability(
            available=False, off_by=MemorySwitch.GROUP, reason="Memory isn't available to your group"
        )
    return MemoryAvailability(available=True)
