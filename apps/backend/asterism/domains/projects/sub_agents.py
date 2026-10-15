"""Atomic project selections. Runtime reads this boundary, never membership tables."""

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import CodedException, NotFoundException
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.queries import select_owned_agent_profiles
from asterism.domains.agent.service import _sub_definition, get_agent_profile

from .models import ProjectSubAgentModel
from .queries import selected_agent_ids
from .schemas import ProjectSubAgentBatch, ProjectSubAgentBatchResult, ProjectSubAgentList
from .service import _owned_project, _write_project, advance_context_revision


async def list_project_sub_agents(
    *,
    user_id: str,
    project_id: uuid.UUID,
    session: AsyncSession,
    page: int = 1,
    page_size: int = 50,
) -> ProjectSubAgentList:
    project = await _owned_project(user_id=user_id, project_id=project_id, session=session)
    statement = select_owned_agent_profiles(user_id).where(
        AgentProfileModel.sub_agent.is_(True),
        AgentProfileModel.id.in_(selected_agent_ids(user_id=user_id, project_id=project_id)),
    )
    total = await session.scalar(select(func.count()).select_from(statement.subquery()))
    rows = await session.scalars(
        statement.order_by(AgentProfileModel.name, AgentProfileModel.id)
        .offset((page - 1) * page_size)
        .limit(page_size),
    )
    definitions = [await _sub_definition(await get_agent_profile(user_id, row.id, session), session) for row in rows]
    return ProjectSubAgentList(
        context_revision=project.context_revision,
        agents=definitions,
        total=total or 0,
        page=page,
        page_size=page_size,
    )


async def change_project_sub_agents(
    *,
    user_id: str,
    project_id: uuid.UUID,
    payload: ProjectSubAgentBatch,
    remove: bool,
    session: AsyncSession,
) -> ProjectSubAgentBatchResult:
    ids = sorted(set(payload.agent_ids), key=str)
    try:
        project = await _write_project(
            user_id=user_id,
            project_id=project_id,
            expected_context_revision=payload.expected_context_revision,
            changes={},
            advance_revision=False,
            session=session,
        )
        owned = set(
            await session.scalars(
                select_owned_agent_profiles(user_id)
                .with_only_columns(AgentProfileModel.id)
                .where(
                    AgentProfileModel.id.in_(ids),
                    AgentProfileModel.sub_agent.is_(True),
                )
            )
        )
        if owned != set(ids):
            raise NotFoundException("Sub-agent not found")
        existing = set(await session.scalars(selected_agent_ids(user_id=user_id, project_id=project_id)))
        changed = [agent_id for agent_id in ids if (agent_id in existing) == remove]
        revision = project.context_revision
        if changed:
            if remove:
                await session.execute(
                    delete(ProjectSubAgentModel).where(
                        ProjectSubAgentModel.project_id == project_id,
                        ProjectSubAgentModel.user_id == user_id,
                        ProjectSubAgentModel.agent_id.in_(changed),
                    )
                )
            else:
                session.add_all(
                    [ProjectSubAgentModel(project_id=project_id, agent_id=aid, user_id=user_id) for aid in changed]
                )
            revision = await advance_context_revision(
                user_id=user_id,
                project_id=project_id,
                expected_context_revision=revision,
                session=session,
            )
        await session.commit()
        return ProjectSubAgentBatchResult(
            context_revision=revision,
            changed_agent_ids=changed,
            unchanged_agent_ids=[aid for aid in ids if aid not in changed],
        )
    except IntegrityError as error:
        await session.rollback()
        raise CodedException(409, "Project sub-agents changed; reload and retry") from error
    except Exception:
        await session.rollback()
        raise
