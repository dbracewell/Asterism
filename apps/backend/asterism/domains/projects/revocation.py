"""Selection revocation owned by projects; participates in caller transactions."""

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ProjectModel, ProjectSubAgentModel


async def revoke_agent_projects(*, user_id: str, agent_id: uuid.UUID, session: AsyncSession) -> None:
    """Advance affected projects in the definition deletion transaction; FK cleans links."""
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
