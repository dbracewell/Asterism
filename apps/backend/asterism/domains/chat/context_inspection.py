"""Owner-only read of the prompt layers a recorded run used (US-54.3).

The layer text comes from the run's immutable execution record, so it shows
exactly what the model was given, never the current persona, skills or
instructions. Only the chat owner can read it.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import NotFoundException

from .execution_models import ChatExecutionModel
from .models import MessageModel
from .queries import select_owned_executions, select_owned_messages
from .schemas import ContextLayerText, ContextLayerTexts


async def read_context_layers(
    *, user_id: str, chat_id: uuid.UUID, message_id: uuid.UUID, session: AsyncSession
) -> ContextLayerTexts:
    message = await session.scalar(
        select_owned_messages(user_id=user_id, chat_id=chat_id).where(MessageModel.id == message_id)
    )
    if message is None or message.role != "assistant" or message.execution_id is None:
        raise NotFoundException("Recorded context not found")
    record = await session.scalar(
        select_owned_executions(user_id=user_id, chat_id=chat_id).where(ChatExecutionModel.id == message.execution_id)
    )
    if record is None:
        raise NotFoundException("Recorded context not found")
    return ContextLayerTexts(
        layers=[
            ContextLayerText(kind=layer.kind, source_id=layer.source_id, revision=layer.revision, text=layer.text)
            for layer in record.prompt.layers
        ]
    )
