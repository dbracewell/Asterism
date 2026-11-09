"""Two opt-in switches: the admin policy and the user's own setting (ADR-0063)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.service import get_user_setting, upsert_app_setting

from .schemas import CanvasPolicy

POLICY_KEY = "canvas_enabled"
USER_SETTING_KEY = "canvas_enabled"


async def read_policy(session: AsyncSession) -> CanvasPolicy:
    row = await session.get(ApplicationSettingsModel, POLICY_KEY)
    # Malformed direct writes cannot turn the policy on through truthiness.
    return CanvasPolicy(enabled=row is not None and row.value is True)


async def write_policy(payload: CanvasPolicy, session: AsyncSession) -> CanvasPolicy:
    await upsert_app_setting(POLICY_KEY, payload.enabled, session=session)
    return await read_policy(session)


async def user_enabled(user_id: str, session: AsyncSession) -> bool:
    return await get_user_setting(user_id, USER_SETTING_KEY, session) is True


async def canvas_available(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> bool:
    """Canvas writing is on for this owned, ordinary chat: both switches are on."""
    from asterism.domains.chat.models import ChatModel
    from asterism.domains.chat.queries import select_owned_chats

    purpose = await session.scalar(
        select_owned_chats(user_id=user_id).with_only_columns(ChatModel.purpose).where(ChatModel.id == chat_id)
    )
    if purpose != "conversation":
        return False
    return (await read_policy(session)).enabled and await user_enabled(user_id, session)


async def require_canvas(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> None:
    if not await canvas_available(user_id, chat_id, session):
        raise BadDataException("Canvas is turned off for this chat")


async def require_owned_chat(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> None:
    from asterism.domains.chat.models import ChatModel
    from asterism.domains.chat.queries import select_owned_chats

    found = await session.scalar(
        select_owned_chats(user_id=user_id).with_only_columns(ChatModel.id).where(ChatModel.id == chat_id)
    )
    if found is None:
        raise NotFoundException("Chat not found")
