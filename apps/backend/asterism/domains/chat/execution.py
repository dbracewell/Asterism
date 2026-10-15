"""Persisted execution snapshots distinguish a resumed turn from regeneration."""

import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import CodedException, NotFoundException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.schemas import MainAgentConfiguration
from asterism.domains.agent.service import get_main_agent_profile

from .model_selection import require_chat_model
from .models import ChatModel, MessageModel
from .queries import select_owned_messages
from .schemas import MessageExecution


async def prepare_execution(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    restart: bool = False,
    session: AsyncSession | None = None,
) -> MessageExecution:
    async with get_async_db_session(session) as session:
        try:
            # Job start has already acquired the process-local run guard; the write
            # lock keeps the selection/configuration read and snapshot atomic.
            chat = await session.scalar(
                update(ChatModel)
                .where(ChatModel.id == chat_id, ChatModel.user_id == user_id)
                .values(updated_at=ChatModel.updated_at)
                .returning(ChatModel)
                .execution_options(populate_existing=True),
            )
            message = await session.scalar(
                select_owned_messages(user_id=user_id, chat_id=chat_id).where(MessageModel.id == message_id),
            )
            if chat is None or message is None:
                raise NotFoundException("Chat turn not found")
            current = MainAgentConfiguration.model_validate(await get_main_agent_profile(user_id, session))
            recorded = message.pending_execution
            if recorded is not None and not restart:
                await validate_recorded_execution(recorded, current, session)
                execution = recorded
            else:
                if chat.selected_model_id is None:
                    raise CodedException(409, "Choose a chat model before generating")
                choice = await require_chat_model(chat.selected_model_id, session)
                execution = MessageExecution(
                    request_message_id=message_id,
                    model=choice,
                    model_revision=chat.model_revision,
                    configuration=current,
                )
                message.pending_execution = execution
            await session.commit()
            return execution
        except BaseException:
            await session.rollback()
            raise


async def validate_recorded_execution(
    recorded: MessageExecution,
    current: MainAgentConfiguration,
    session: AsyncSession,
):
    choice = await require_chat_model(recorded.model.id, session)
    if (
        choice.name != recorded.model.name
        or choice.provider_id != recorded.model.provider_id
        or choice.supports_vision != recorded.model.supports_vision
        or choice.context_window != recorded.model.context_window
    ):
        raise CodedException(409, "Recorded model identity changed; regenerate with the current selection")
    if not set(recorded.configuration.tools) <= set(current.tools) or not {
        base.id for base in recorded.configuration.knowledge_bases
    } <= {base.id for base in current.knowledge_bases}:
        raise CodedException(409, "Recorded capabilities changed; regenerate with current settings")
    return choice
