"""Writing the admin memory policy (ADR-0078). Kept apart from ``policy`` so the
settings service can read memory availability without an import cycle."""

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException
from asterism.domains.settings.service import upsert_app_setting

from .access import POLICY_KEY, read_policy
from .schemas import MemoryPolicy


async def write_policy(payload: MemoryPolicy, session: AsyncSession) -> MemoryPolicy:
    if payload.group_ids is not None:
        from asterism.domains.groups.service import list_groups

        known = {group.id for group in await list_groups(session)}
        if unknown := set(payload.group_ids) - known:
            raise BadDataException(f"Unknown groups: {', '.join(sorted(unknown))}")
        payload = payload.model_copy(update={"group_ids": sorted(set(payload.group_ids))})
    await upsert_app_setting(POLICY_KEY, payload.model_dump(mode="json"), session=session)
    return await read_policy(session)
