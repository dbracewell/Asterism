"""Owner-scoped chat selects; callers add scope before pagination."""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, or_, select

from .models import ChatModel, MessageModel


def select_owned_chats(*, user_id: str):
    return (
        select(ChatModel)
        .where(ChatModel.user_id == user_id)
        .order_by(
            ChatModel.updated_at.desc(),
            ChatModel.id.asc(),
        )
    )


def select_owned_messages(*, user_id: str, chat_id):
    return select(MessageModel).where(MessageModel.user_id == user_id, MessageModel.chat_id == chat_id)


def select_owned_message_snippets(*, user_id: str, chat_ids: Sequence[uuid.UUID], terms: Sequence[str]):
    """First chronological matching message for each requested page chat.

    Callers pass only selected-page chats needing content snippets. All terms
    already matched the chat index; a snippet preserves the earliest message
    containing any term, with message ID breaking equal-timestamp ties.
    """
    ranked = (
        select(
            MessageModel.chat_id,
            MessageModel.content,
            func.row_number()
            .over(
                partition_by=MessageModel.chat_id,
                order_by=(MessageModel.created_at, MessageModel.id),
            )
            .label("position"),
        )
        .where(
            MessageModel.user_id == user_id,
            MessageModel.chat_id.in_(chat_ids),
            or_(*(MessageModel.content.icontains(term, autoescape=True) for term in terms)),
        )
        .subquery()
    )
    return select(ranked.c.chat_id, ranked.c.content).where(ranked.c.position == 1)
