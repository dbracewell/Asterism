"""Owner-scoped base selects for memories. Filters apply in the database before pagination."""

import uuid

from sqlalchemy import func, select

from .models import MemoryKind, MemoryModel


def select_owned_memories(user_id: str):
    return select(MemoryModel).where(MemoryModel.user_id == user_id)


def filter_memories(statement, *, kind: MemoryKind | None = None, project_id: uuid.UUID | None = None):
    if kind is not None:
        statement = statement.where(MemoryModel.kind == kind)
    if project_id is not None:
        statement = statement.where(MemoryModel.project_id == project_id)
    return statement


def order_memories(statement):
    # Newest change first; the id breaks ties so pages never overlap or skip.
    return statement.order_by(MemoryModel.updated_at.desc(), MemoryModel.id)


def count_owned_memories(user_id: str, *, kind: MemoryKind, project_id: uuid.UUID | None):
    statement = select(func.count(MemoryModel.id)).where(MemoryModel.user_id == user_id, MemoryModel.kind == kind)
    if project_id is not None:
        statement = statement.where(MemoryModel.project_id == project_id)
    return statement
