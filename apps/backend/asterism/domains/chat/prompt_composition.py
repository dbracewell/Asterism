"""Composition root for domain readers; the composer itself never reads storage."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.db.database import get_async_db_session
from asterism.domains.agent.execution_scope import ChatScopeSnapshot, ProjectScopeSnapshot
from asterism.domains.agent.prompts import PromptComposer, PromptSnapshot
from asterism.domains.agent.schemas import AgentProfile
from asterism.domains.tools.context import ContextToolScope

from .delegation import eligible_delegation_targets
from .scope import read_chat_scope_snapshot, read_project_scope_snapshot
from .tool_policy import resolve_effective_tools


async def build_prompt_snapshot(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    profile: AgentProfile,
    model_id: uuid.UUID | None,
    session: AsyncSession | None = None,
    ceiling: ContextToolScope | None = None,
    chat_snapshot: ChatScopeSnapshot | None = None,
    project_snapshot: ProjectScopeSnapshot | None = None,
) -> PromptSnapshot:
    async with get_async_db_session(session) as db:
        chat = chat_snapshot or await read_chat_scope_snapshot(user_id=user_id, chat_id=chat_id, session=db)
        project = (
            project_snapshot
            if project_snapshot is not None
            else (
                await read_project_scope_snapshot(user_id=user_id, project_id=chat.project_id, session=db)
                if chat.project_id
                else None
            )
        )
        project_id = project.project_id if project else None
        revision = project.prompt_revision if project else None
        instructions = project.system_prompt if project else ""
        tools, scope = await resolve_effective_tools(
            user_id=user_id,
            chat_id=chat_id,
            profile=profile,
            model_id=model_id,
            ceiling=ceiling,
            session=db,
            chat_snapshot=chat,
            project_snapshot=project,
        )
        runtime = await build_runtime_prompt(
            user_id=user_id,
            chat_id=chat_id,
            profile=profile,
            tools=tools,
            scope=scope,
            session=db,
        )
        return PromptComposer().snapshot(
            agent_id=profile.id,
            agent_revision=profile.config_revision,
            agent_instructions=profile.system_prompt or "",
            project_id=project_id,
            project_revision=revision,
            project_instructions=instructions,
            runtime_context=runtime,
        )


async def build_runtime_prompt(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    profile: AgentProfile,
    tools: list[str],
    scope: ContextToolScope | None,
    session: AsyncSession | None = None,
) -> str:
    runtime = f"Server-authorized tools at turn start: {', '.join(tools) or 'none'}."
    if "sub_agent" in tools:
        targets = await eligible_delegation_targets(
            user_id=user_id,
            chat_id=chat_id,
            scope=scope.delegation if scope else None,
            session=session,
        )
        rows = [
            f"- id: {target.id} (name: {target.name}) - {target.description}"
            for target in targets
            if target.id != profile.id
        ]
        if rows:
            runtime += (
                "\nUse sub_agent to delegate tasks to these eligible agents. "
                "Include their relevant results in your response.\nSub Agents:\n" + "\n".join(rows)
            )
    return runtime
