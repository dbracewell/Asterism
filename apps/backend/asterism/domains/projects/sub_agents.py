"""Atomic project selections. Runtime reads this boundary, never membership tables."""

import uuid

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import CodedException, NotFoundException
from asterism.db.queries import QueryPage, paginate_select
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.queries import select_owned_agent_profiles
from asterism.domains.agent.schemas import AgentProfile
from asterism.domains.agent.service import _sub_definition

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
    page_result = await paginate_select(
        statement=statement.order_by(AgentProfileModel.name, AgentProfileModel.id),
        session=session,
        page=page,
        page_size=page_size,
    )
    return await _agent_page(page_result, project.context_revision, session)


async def list_project_sub_agent_candidates(
    *,
    user_id: str,
    project_id: uuid.UUID,
    session: AsyncSession,
    page: int = 1,
    page_size: int = 10,
) -> ProjectSubAgentList:
    project = await _owned_project(user_id=user_id, project_id=project_id, session=session)
    statement = (
        select_owned_agent_profiles(user_id)
        .where(
            AgentProfileModel.sub_agent.is_(True),
            AgentProfileModel.id.not_in(selected_agent_ids(user_id=user_id, project_id=project_id)),
        )
        .order_by(AgentProfileModel.name, AgentProfileModel.id)
    )
    page_result = await paginate_select(statement=statement, session=session, page=page, page_size=page_size)
    return await _agent_page(page_result, project.context_revision, session)


async def _agent_page(
    result: QueryPage[AgentProfileModel],
    revision: int,
    session: AsyncSession,
) -> ProjectSubAgentList:
    definitions = [await _sub_definition(AgentProfile.model_validate(row), session) for row in result.records]
    return ProjectSubAgentList(
        context_revision=revision,
        agents=definitions,
        total=result.total,
        page=result.page,
        page_size=result.page_size,
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
