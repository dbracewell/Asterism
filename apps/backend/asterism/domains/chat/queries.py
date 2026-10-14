"""Owner-scoped chat selects; callers add scope before pagination."""

from sqlalchemy import select

from .models import ChatModel


def select_owned_chats(*, user_id: str):
    return (
        select(ChatModel)
        .where(ChatModel.user_id == user_id)
        .order_by(
            ChatModel.updated_at.desc(),
            ChatModel.id.asc(),
        )
    )
