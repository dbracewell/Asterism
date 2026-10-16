"""Chat composition root for atomic execution-source provenance."""

import uuid
from dataclasses import replace
from functools import partial

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.agent.context_provenance import ContextProvenance, describe_context
from asterism.domains.agent.execution_scope import ModelIdentity, resolve_execution_scope
from asterism.domains.agent.schemas import AgentProfile
from asterism.domains.tools.catalog import INTERNAL_TOOL_NAMES

from .schemas import MessageExecution
from .scope import read_chat_scope_snapshot, read_project_scope_snapshot
from .tool_policy import resolve_effective_tools


async def build_execution_provenance(
    *, user_id: str, chat_id: uuid.UUID, execution: MessageExecution, session: AsyncSession
) -> ContextProvenance:
    profile = AgentProfile.model_validate(
        {**execution.configuration.model_dump(exclude_none=True), "sub_agent": False, "model_id": None}
    )
    tools, _ = await resolve_effective_tools(
        user_id=user_id, chat_id=chat_id, profile=profile, model_id=execution.model.id, session=session
    )
    identity = ModelIdentity(id=execution.model.id, provider_id=execution.model.provider_id, name=execution.model.name)
    scope = await resolve_execution_scope(
        user_id=user_id,
        user_profile_id=None,
        agent_id=execution.configuration.id,
        is_sub_agent=False,
        chat_id=chat_id,
        selected_model=identity,
        executed_model=identity,
        effective_internal_tools=frozenset(set(tools) & INTERNAL_TOOL_NAMES),
        configuration_revision=execution.configuration.config_revision,
        chat_scope_reader=partial(read_chat_scope_snapshot, user_id=user_id, chat_id=chat_id, session=session),
        project_scope_reader=lambda project_id: read_project_scope_snapshot(
            user_id=user_id, project_id=project_id, session=session
        ),
    )
    return describe_context(replace(scope, execution_id=execution.id, request_message_id=execution.request_message_id))
