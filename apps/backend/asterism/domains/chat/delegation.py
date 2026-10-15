"""Live delegation authorization, separate from agent runtime and project storage."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, CodedException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.delegation_scope import DelegationScope
from asterism.domains.agent.schemas import AgentProfile
from asterism.domains.agent.service import get_agent_profile
from asterism.domains.projects.queries import selected_agent_ids
from asterism.domains.projects.service import get_project
from asterism.domains.settings.models import LLMModel

from .models import ChatModel


async def resolve_delegation_scope(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    session: AsyncSession | None = None,
) -> DelegationScope | None:
    async with get_async_db_session(session) as session:
        chat = await session.get(ChatModel, chat_id)
        if chat is None or chat.user_id != user_id or chat.project_id is None:
            return None
        project = await get_project(user_id=user_id, project_id=chat.project_id, session=session)
        ids = frozenset(await session.scalars(selected_agent_ids(user_id=user_id, project_id=project.id)))
        return DelegationScope(
            chat_id=chat_id, project_id=project.id, context_revision=project.context_revision, agent_ids=ids
        )


async def require_delegation_target(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    scope: DelegationScope | None,
    target_id: uuid.UUID,
    config_revision: int | None = None,
    session: AsyncSession | None = None,
) -> AgentProfile:
    if scope is None or scope.chat_id != chat_id or target_id not in scope.agent_ids:
        raise BadDataException("Sub-agent is not selected for this project; General chats cannot delegate")
    async with get_async_db_session(session) as session:
        current = await resolve_delegation_scope(user_id=user_id, chat_id=chat_id, session=session)
        if (
            current is None
            or current.project_id != scope.project_id
            or current.context_revision != scope.context_revision
            or target_id not in current.agent_ids
        ):
            raise BadDataException("Project delegation context changed; start a new turn")
        profile = await get_agent_profile(user_id, target_id, session)
        if not profile.sub_agent or (config_revision is not None and profile.config_revision != config_revision):
            raise BadDataException("Sub-agent configuration changed; start a new delegation")
        model = await session.get(LLMModel, profile.model_id)
        if model is None or not model.is_active:
            raise BadDataException("Sub-agent model is unavailable; edit the sub-agent definition")
        return profile


async def eligible_delegation_targets(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    scope: DelegationScope | None,
) -> list[AgentProfile]:
    if scope is None:
        return []
    targets = []
    for target_id in sorted(scope.agent_ids, key=str):
        try:
            targets.append(
                await require_delegation_target(user_id=user_id, chat_id=chat_id, scope=scope, target_id=target_id)
            )
        except CodedException:
            # Revoked/missing/unavailable definitions are never advertised.
            continue
    return targets
