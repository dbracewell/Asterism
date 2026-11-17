"""Owner-scoped reflection selects; partition filters apply before pagination."""

import uuid

from sqlalchemy import select

from .models import ReflectionModel


def select_owned_reflections(user_id: str):
    return select(ReflectionModel).where(ReflectionModel.user_id == user_id)


def select_scoped_reflections(user_id: str, *, project_id: uuid.UUID | None):
    """One project's reflections (General when ``project_id`` is None)."""
    statement = select_owned_reflections(user_id).where(
        ReflectionModel.project_id == project_id if project_id is not None else ReflectionModel.project_id.is_(None)
    )
    return statement.order_by(ReflectionModel.created_at.desc(), ReflectionModel.id)
