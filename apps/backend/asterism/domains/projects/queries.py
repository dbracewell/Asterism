"""Owner-scoped project query construction."""

from sqlalchemy import select

from .models import ProjectModel


def select_owned_projects(*, user_id: str):
    return select(ProjectModel).where(ProjectModel.user_id == user_id)
