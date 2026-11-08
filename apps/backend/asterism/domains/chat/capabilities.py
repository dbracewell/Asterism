"""Build the capability manifest recorded with each agent run (US-54.2).

The inputs are the already-authorized results of tool, skill, file and
delegation resolution for the run, so the manifest describes exactly what the
run was given. This module only names the grants behind each entry and adds
display names; it never widens or re-derives authorization.
"""

import uuid
from collections.abc import Collection, Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.agent.capabilities import (
    CapabilityApproval,
    CapabilityEntry,
    CapabilityGrant,
    CapabilityKind,
    CapabilityManifest,
)
from asterism.domains.agent.delegation_scope import DelegationScope
from asterism.domains.agent.execution_scope import FileProvenance
from asterism.domains.agent.schemas import AgentProfile
from asterism.domains.agent.skill_inputs import SkillIdentity
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.queries import select_owned_files
from asterism.domains.tools.catalog import INTERNAL_TOOL_NAMES

from .delegation import eligible_delegation_targets

_TOOL_GRANTS = {
    "sub_agent": [CapabilityGrant.ADMIN_POLICY, CapabilityGrant.MODEL_SUPPORT, CapabilityGrant.PROJECT_SELECTION],
    "search_knowledge": [CapabilityGrant.ADMIN_POLICY, CapabilityGrant.MODEL_SUPPORT, CapabilityGrant.FILE_SCOPE],
}
_ORDINARY_TOOL_GRANTS = [
    CapabilityGrant.AGENT_ASSIGNMENT,
    CapabilityGrant.ADMIN_POLICY,
    CapabilityGrant.MODEL_SUPPORT,
]
_SKILL_GRANTS = [CapabilityGrant.CHAT_SELECTION, CapabilityGrant.AGENT_ASSIGNMENT, CapabilityGrant.ADMIN_POLICY]
_FILE_GRANTS = {"project": CapabilityGrant.PROJECT_SELECTION, "chat": CapabilityGrant.CHAT_ATTACHMENT}


def tool_entries(tools: Collection[str], auto_approved: Collection[str] | None) -> list[CapabilityEntry]:
    """``auto_approved`` of None means every call runs without asking (sub-agents)."""

    def approval(name: str) -> CapabilityApproval:
        if auto_approved is None or name in INTERNAL_TOOL_NAMES or name in auto_approved:
            return CapabilityApproval.AUTOMATIC
        return CapabilityApproval.ASK

    return [
        CapabilityEntry(
            kind=CapabilityKind.TOOL,
            id=name,
            name=name,
            grants=_TOOL_GRANTS.get(name, _ORDINARY_TOOL_GRANTS),
            approval=approval(name),
        )
        for name in sorted(tools)
    ]


def skill_entries(skills: Sequence[SkillIdentity]) -> list[CapabilityEntry]:
    return [
        CapabilityEntry(
            kind=CapabilityKind.SKILL, id=str(skill.id), name=skill.name, grants=_SKILL_GRANTS, revision=skill.revision
        )
        for skill in skills
    ]


async def file_entries(
    *, user_id: str, files: Sequence[FileProvenance], session: AsyncSession
) -> list[CapabilityEntry]:
    if not files:
        return []
    names = {
        row.id: row.filename
        for row in await session.scalars(
            select_owned_files(user_id=user_id).where(UserFileModel.id.in_([file.file_id for file in files]))
        )
    }
    entries = [
        CapabilityEntry(
            kind=CapabilityKind.FILE,
            id=str(file.file_id),
            name=names.get(file.file_id),
            grants=[_FILE_GRANTS[source] for source in file.sources],
        )
        for file in files
        if file.sources
    ]
    return sorted(entries, key=lambda entry: ((entry.name or "").casefold(), entry.id))


async def sub_agent_entries(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    caller_id: uuid.UUID,
    delegation: DelegationScope | None,
    session: AsyncSession,
) -> list[CapabilityEntry]:
    targets = await eligible_delegation_targets(user_id=user_id, chat_id=chat_id, scope=delegation, session=session)
    grant = (
        CapabilityGrant.GENERAL_SELECTION
        if delegation is not None and delegation.source == "general"
        else CapabilityGrant.PROJECT_SELECTION
    )
    return [
        CapabilityEntry(
            kind=CapabilityKind.SUB_AGENT,
            id=str(target.id),
            name=target.name,
            grants=[grant],
            revision=target.config_revision,
        )
        for target in sorted(targets, key=lambda target: (target.name.casefold(), str(target.id)))
        if target.id != caller_id
    ]


async def build_capability_manifest(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    profile: AgentProfile,
    model_supports_tools: bool | None,
    tools: Collection[str],
    auto_approved_tools: Collection[str] | None,
    skills: Sequence[SkillIdentity],
    files: Sequence[FileProvenance],
    delegation: DelegationScope | None,
    session: AsyncSession,
) -> CapabilityManifest:
    """Describe an authorized run: ``tools`` and ``files`` must be its effective sets."""
    # The agent offers tools only on steps that leave room to answer, so a
    # single-step agent never had any (see Agent.run).
    tools = tools if profile.max_steps > 1 else ()
    entries = [
        *tool_entries(tools, auto_approved_tools),
        *skill_entries(skills),
        *(
            await sub_agent_entries(
                user_id=user_id, chat_id=chat_id, caller_id=profile.id, delegation=delegation, session=session
            )
            if "sub_agent" in tools
            else []
        ),
        *await file_entries(user_id=user_id, files=files, session=session),
    ]
    return CapabilityManifest(
        agent_id=profile.id,
        agent_name=profile.name,
        is_sub_agent=profile.sub_agent,
        configuration_revision=profile.config_revision,
        model_supports_tools=model_supports_tools,
        entries=entries,
    )
