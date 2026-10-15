"""Owner-scoped project query construction."""

import uuid

from sqlalchemy import select

from .models import ProjectModel, ProjectSubAgentModel


def select_owned_projects(*, user_id: str):
    return select(ProjectModel).where(ProjectModel.user_id == user_id)


def selected_agent_ids(*, user_id: str, project_id: uuid.UUID):
    return select(ProjectSubAgentModel.agent_id).where(
        ProjectSubAgentModel.user_id == user_id,
        ProjectSubAgentModel.project_id == project_id,
    )
