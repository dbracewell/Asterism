"""Composition root for domain readers; the composer itself never reads storage."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.db.database import get_async_db_session
from asterism.domains.agent.execution_scope import ChatScopeSnapshot, ProjectScopeSnapshot
from asterism.domains.agent.learning_inputs import LearningModeSnapshot
from asterism.domains.agent.prompts import (
    PersonaSnapshot,
    PromptComposer,
    PromptLayer,
    PromptSnapshot,
    skill_catalog_layer,
)
from asterism.domains.agent.schemas import AgentProfile
from asterism.domains.agent.skill_inputs import SkillCatalogEntry, SkillSnapshot
from asterism.domains.tools.catalog import SKILL_TOOL_NAME
from asterism.domains.tools.context import ContextToolScope

from .delegation import eligible_delegation_targets
from .personas import read_pending_or_current_persona
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
    skills: tuple[SkillSnapshot, ...] | None = None,
    persona_snapshot: PersonaSnapshot | None = None,
    learning_mode: LearningModeSnapshot | None = None,
    chat_snapshot: ChatScopeSnapshot | None = None,
    project_snapshot: ProjectScopeSnapshot | None = None,
) -> PromptSnapshot:
    async with get_async_db_session(session) as db:
        chat = chat_snapshot or await read_chat_scope_snapshot(user_id=user_id, chat_id=chat_id, session=db)
        drafting = chat.purpose == "skill_draft"
        if drafting:
            from asterism.domains.skills.policy import require_drafting_enabled

            # Live policy (ADR-0061): turning skills off stops every drafting turn.
            await require_drafting_enabled(db)
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
        persona = persona_snapshot or await read_pending_or_current_persona(
            user_id=user_id,
            chat_id=chat_id,
            branch_ids=chat.active_branch_message_ids,
            session=db,
        )
        if learning_mode is None and not profile.sub_agent and not drafting:
            from .learning_modes import read_pending_or_current_mode

            learning_mode = await read_pending_or_current_mode(
                user_id=user_id, chat_id=chat_id, branch_ids=chat.active_branch_message_ids, session=db
            )
        if skills is None:
            from asterism.domains.skills.activation import validate_snapshots

            from .skills import branch_skills

            skills = () if profile.sub_agent or drafting else (await branch_skills(user_id, chat_id, db)).snapshots
            await validate_snapshots(user_id, skills, db)
        _, catalog_layer = await read_skill_catalog_layer(user_id=user_id, profile=profile, tools=tools, session=db)
        return PromptComposer().snapshot(
            skills=skills,
            skill_catalog_layer=catalog_layer,
            profile_layer=persona.layer,
            # Delegated agents never inherit the learner-facing mode layer.
            mode_layer=(
                learning_mode.layer if learning_mode is not None and not profile.sub_agent and not drafting else None
            ),
            # Only the writer gets the skill-writing task; its sub-agents just help.
            task_layer=_skill_writer_layer() if drafting and not profile.sub_agent else None,
            agent_id=profile.id,
            agent_revision=profile.config_revision,
            agent_instructions=profile.system_prompt or "",
            project_id=project_id,
            project_revision=revision,
            project_instructions=instructions,
            runtime_context=runtime,
        )


async def read_skill_catalog_layer(
    *, user_id: str, profile: AgentProfile, tools: list[str], session: AsyncSession | None = None
) -> tuple[tuple[SkillCatalogEntry, ...], PromptLayer | None]:
    """A sub-agent's loadable skills and their catalog layer, when it was offered load_skill (ADR-0062)."""
    if not profile.sub_agent or SKILL_TOOL_NAME not in tools:
        return (), None
    from asterism.domains.skills.loading import read_skill_catalog

    async with get_async_db_session(session) as db:
        rows = await read_skill_catalog(user_id, profile.id, db)
        entries = tuple(SkillCatalogEntry.model_validate(row) for row in rows)
    return entries, skill_catalog_layer(entries)


def _skill_writer_layer():
    from asterism.domains.skills.writer import SKILL_WRITER_LAYER

    return SKILL_WRITER_LAYER


FILE_REFERENCE_GUIDANCE = (
    "\nFiles: to show one of the user's files in your reply, write "
    "![short description](asterism-file:<file id>) to embed it (images display inline, "
    "documents as cards) or [label](asterism-file:<file id>) to mention it. "
    "Use only file ids given to you in this conversation: attached files, search results "
    "or tool results. Any other id shows as unavailable. Never write URLs to files."
)
"""ADR-0039 §9: explains the syntax only when the run can see files. It grants nothing."""

CITATION_GUIDANCE = (
    "\nCitations: when a claim in your reply relies on a search_knowledge result, wrap that claim "
    "in a link to the result's citation: [the claim](asterism-cite:<key>). To cite up to four "
    "results for one claim, separate their keys with commas: [the claim](asterism-cite:<key>,<key>). "
    "Cite only citations returned to you in this run, and only for claims the excerpt supports. "
    "Keep each linked span to the claim itself, usually one sentence."
)
"""ADR-0040: explains claim citations only when the run can search. It grants nothing."""


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
    if scope is not None and scope.file_ids:
        runtime += FILE_REFERENCE_GUIDANCE
    if "search_knowledge" in tools:
        runtime += CITATION_GUIDANCE
    return runtime
