"""Selection revocation owned by projects; participates in caller transactions."""

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ProjectModel, ProjectSubAgentModel


async def revoke_agent_projects(*, user_id: str, agent_id: uuid.UUID, session: AsyncSession) -> None:
    """Drop an agent's project selections when its definition is deleted.

    Called by the agent domain inside the definition-deletion transaction (no
    commit here). The composite FK cascades away the ``project_sub_agents`` rows;
    this function only advances each affected project's context revision so
    in-flight project writes detect that their selection set just changed.
    """
    await session.execute(
        update(ProjectModel)
        .where(
            ProjectModel.user_id == user_id,
            ProjectModel.id.in_(
                select(ProjectSubAgentModel.project_id).where(
                    ProjectSubAgentModel.user_id == user_id,
                    ProjectSubAgentModel.agent_id == agent_id,
                )
            ),
        )
        .values(context_revision=ProjectModel.context_revision + 1)
    )
