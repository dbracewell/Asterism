"""Compose live policy through domain readers; the Agent does not read domain tables."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.execution_scope import ChatScopeSnapshot, ProjectScopeSnapshot
from asterism.domains.agent.schemas import AgentProfile
from asterism.domains.agent.service import get_agent_profile
from asterism.domains.settings.models import LLMModel
from asterism.domains.settings.tool_settings import get_tool_settings
from asterism.domains.tools.catalog import INTERNAL_TOOL_NAMES, configurable_tools
from asterism.domains.tools.context import ContextToolScope

from .delegation import eligible_delegation_targets, require_delegation_target, resolve_delegation_scope
from .scope import resolve_chat_file_scope


async def resolve_effective_tools(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    profile: AgentProfile,
    model_id: uuid.UUID | None,
    ceiling: ContextToolScope | None = None,
    session: AsyncSession | None = None,
    chat_snapshot: ChatScopeSnapshot | None = None,
    project_snapshot: ProjectScopeSnapshot | None = None,
) -> tuple[list[str], ContextToolScope | None]:
    if model_id is None:
        return [], None
    async with get_async_db_session(session) as db:
        model = await db.get(LLMModel, model_id)
        if model is None or not model.is_active:
            return [], ceiling
        current = await get_agent_profile(user_id, profile.id, db)
        if current.sub_agent and current.model_id != model_id:
            raise BadDataException("Sub-agent model binding changed")
        settings = await get_tool_settings(db)
        active = set(settings.active_tools)
        names = (
            (set(configurable_tools(profile.tools or [])) & set(current.tools or []) & active)
            if model.supports_tools is True
            else set()
        )
        files = await resolve_chat_file_scope(
            user_id=user_id,
            chat_id=chat_id,
            session=db,
            chat_snapshot=chat_snapshot,
            project_snapshot=project_snapshot,
        )
        if ceiling is None:
            # Children must inherit a ceiling; they cannot resolve a wider one.
            if profile.sub_agent:
                return sorted(names), None
            ceiling = ContextToolScope(
                user_id=user_id,
                chat_id=chat_id,
                project_id=files.project_id,
                caller_agent_id=profile.id,
                model_id=model_id,
                file_ids=frozenset(files.allowed_file_ids),
                delegation=await resolve_delegation_scope(
                    user_id=user_id, chat_id=chat_id, session=db, project_id=files.project_id
                ),
            )
        if (ceiling.user_id, ceiling.chat_id, ceiling.caller_agent_id, ceiling.model_id) != (
            user_id,
            chat_id,
            profile.id,
            model_id,
        ):
            raise BadDataException("Invalid tool execution context")
        if model.supports_tools is not True:
            return [], ceiling
        if files.project_id != ceiling.project_id:
            return sorted(names), ceiling
        if profile.sub_agent:
            await require_delegation_target(
                user_id=user_id,
                chat_id=chat_id,
                scope=ceiling.delegation,
                target_id=profile.id,
                config_revision=profile.config_revision,
                session=db,
            )
        if "search_knowledge" in active and ceiling.file_ids.intersection(files.allowed_file_ids):
            names.add("search_knowledge")
    if "sub_agent" in active:
        targets = await eligible_delegation_targets(
            user_id=user_id, chat_id=chat_id, scope=ceiling.delegation, session=session
        )
        if any(target.id != profile.id for target in targets):
            names.add("sub_agent")
    return sorted(names), ceiling


async def require_internal_tool(
    *, name: str, user_id: str, chat_id: uuid.UUID, scope: ContextToolScope | None
) -> ContextToolScope:
    if name not in INTERNAL_TOOL_NAMES or scope is None or scope.user_id != user_id or scope.chat_id != chat_id:
        raise BadDataException("Internal tool is unavailable in this execution context")
    async with get_async_db_session() as db:
        model = await db.get(LLMModel, scope.model_id)
        settings = await get_tool_settings(db)
        if (
            model is None
            or not model.is_active
            or model.supports_tools is not True
            or name not in settings.active_tools
        ):
            raise BadDataException("Internal tool authorization was revoked or its context is empty")
        profile = await get_agent_profile(user_id, scope.caller_agent_id, db)
        if profile.sub_agent:
            if profile.model_id != scope.model_id:
                raise BadDataException("Sub-agent model binding changed")
            await require_delegation_target(
                user_id=user_id, chat_id=chat_id, scope=scope.delegation, target_id=profile.id, session=db
            )
        if name == "sub_agent":
            # Polling an in-flight delegation must not scan conversation/file history.
            # The built-in separately validates the actual target before starting work.
            live = await resolve_delegation_scope(user_id=user_id, chat_id=chat_id, session=db)
            if (
                live is None
                or scope.delegation is None
                or live.project_id != scope.project_id
                or live.context_revision != scope.delegation.context_revision
                or not (live.agent_ids & scope.delegation.agent_ids - {profile.id})
            ):
                raise BadDataException("Project delegation authorization changed")
        else:
            files = await resolve_chat_file_scope(user_id=user_id, chat_id=chat_id, session=db)
            if files.project_id != scope.project_id or not scope.file_ids.intersection(files.allowed_file_ids):
                raise BadDataException("Internal tool authorization was revoked or its context is empty")
    return scope
