"""Owner-scoped project query construction."""

import uuid

from sqlalchemy import select

from .models import ProjectModel, ProjectSubAgentModel


def select_owned_projects(*, user_id: str):
    """Base owner-scoped select over the caller's projects.

    Returns an unsorted, unfiltered base statement; callers add their own
    filters (search, id) and ordering before pagination, per the shared query
    convention. Never called directly against the session without a ``user_id``.
    """
    return select(ProjectModel).where(ProjectModel.user_id == user_id)


def selected_agent_ids(*, user_id: str, project_id: uuid.UUID):
    """Scalar subquery of agent ids selected on one owned project.

    Intended for ``IN``/``NOT IN`` composition (e.g. listing selected vs.
    candidate sub-agents), not for direct execution; the owner filter keeps it
    safe to embed even if the caller's project lookup is raced.
    """
    return select(ProjectSubAgentModel.agent_id).where(
        ProjectSubAgentModel.user_id == user_id,
        ProjectSubAgentModel.project_id == project_id,
    )
