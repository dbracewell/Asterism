"""Owner-scoped base selects for canvas items and versions."""

import uuid

from sqlalchemy import select

from .models import CanvasItemModel, CanvasVersionModel


def select_owned_items(*, user_id: str, chat_id: uuid.UUID):
    return select(CanvasItemModel).where(CanvasItemModel.user_id == user_id, CanvasItemModel.chat_id == chat_id)


def select_owned_versions(*, user_id: str, chat_id: uuid.UUID):
    return (
        select(CanvasVersionModel)
        .join(CanvasItemModel, CanvasItemModel.id == CanvasVersionModel.item_id)
        .where(CanvasItemModel.user_id == user_id, CanvasItemModel.chat_id == chat_id)
        .order_by(CanvasVersionModel.item_id, CanvasVersionModel.number)
    )
