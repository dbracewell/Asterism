"""The admin policy, group limits and provider readiness, read live (ADR-0064)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.service import upsert_app_setting

from .providers import load_provider
from .schemas import ImageGenerationAvailability, ImageGenerationPolicy, ImageProviderStatus

POLICY_KEY = "image_generation"


async def read_policy(session: AsyncSession) -> ImageGenerationPolicy:
    row = await session.get(ApplicationSettingsModel, POLICY_KEY)
    if row is None or not isinstance(row.value, dict):
        return ImageGenerationPolicy()
    try:
        return ImageGenerationPolicy.model_validate(row.value)
    except ValueError:
        # A malformed direct write never turns generation on.
        return ImageGenerationPolicy()


async def write_policy(payload: ImageGenerationPolicy, session: AsyncSession) -> ImageGenerationPolicy:
    if payload.group_ids is not None:
        from asterism.domains.groups.service import list_groups

        known = {group.id for group in await list_groups(session)}
        if unknown := set(payload.group_ids) - known:
            raise BadDataException(f"Unknown groups: {', '.join(sorted(unknown))}")
        payload = payload.model_copy(update={"group_ids": sorted(set(payload.group_ids))})
    await upsert_app_setting(POLICY_KEY, payload.model_dump(mode="json"), session=session)
    return await read_policy(session)


async def provider_status(policy: ImageGenerationPolicy, session: AsyncSession) -> ImageProviderStatus:
    provider = await load_provider(policy.provider, session)
    if provider is None:
        return ImageProviderStatus(provider=policy.provider, ready=False, detail="No image provider is set up")
    return await provider.status()


async def availability(user_id: str, session: AsyncSession) -> ImageGenerationAvailability:
    """Policy on, the user's group allowed, and the provider ready."""
    from asterism.domains.groups.service import read_group_id

    policy = await read_policy(session)
    if not policy.enabled:
        return ImageGenerationAvailability(available=False, reason="Image generation is turned off")
    if policy.group_ids is not None and await read_group_id(user_id, session) not in policy.group_ids:
        return ImageGenerationAvailability(available=False, reason="Image generation isn't available to your group")
    status = await provider_status(policy, session)
    if not status.ready:
        return ImageGenerationAvailability(available=False, reason=status.detail or "The image provider isn't ready")
    return ImageGenerationAvailability(available=True)


async def chat_offers_images(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> bool:
    """Images in an owned, ordinary chat for an eligible user."""
    from asterism.domains.chat.models import ChatModel
    from asterism.domains.chat.queries import select_owned_chats

    purpose = await session.scalar(
        select_owned_chats(user_id=user_id).with_only_columns(ChatModel.purpose).where(ChatModel.id == chat_id)
    )
    return purpose == "conversation" and (await availability(user_id, session)).available


async def require_available(user_id: str, session: AsyncSession) -> None:
    state = await availability(user_id, session)
    if not state.available:
        raise BadDataException(state.reason)
