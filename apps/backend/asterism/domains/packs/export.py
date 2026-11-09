"""Build a team pack from a user's own records (US-59.2).

Each item is built from an explicit list of fields, so credentials, record IDs
and generation extras never reach the file. Models become requirements. The
result goes through ``parse_pack``, so an exported file has passed the same
bounds and credential screen as an imported one. Exporting changes nothing.
"""

import json
import re
import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.queries import select_owned_agent_profiles
from asterism.domains.agent.schemas import GenerationDefaults
from asterism.domains.projects.queries import selected_agent_ids
from asterism.domains.projects.schemas import Project
from asterism.domains.projects.service import get_project
from asterism.domains.prompt_templates.models import PromptTemplateModel
from asterism.domains.prompt_templates.queries import select_owned_rubrics, select_owned_templates
from asterism.domains.settings.models import LLMModel
from asterism.domains.settings.queries import select_visible_models
from asterism.domains.skills.models import AgentSkillModel, SkillModel
from asterism.domains.skills.queries import select_owned_assignments, select_owned_skills
from asterism.domains.tools.catalog import configurable_tools

from .documents import MAX_PACK_ID_LENGTH, PACK_FORMAT, PACK_FORMAT_VERSION, PackManifest, parse_pack
from .schemas import PackExportRequest

FALLBACK_PACK_ID = "team-pack"


def pack_id(name: str) -> str:
    """A stable slug of the pack name, so later versions keep the same identity."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:MAX_PACK_ID_LENGTH].rstrip("-") or FALLBACK_PACK_ID


def _require_all(ids: Sequence[uuid.UUID], rows: Sequence[object], label: str) -> None:
    if len(set(ids)) != len(ids):
        raise BadDataException(f"Selected {label} must be unique")
    if len(rows) != len(ids):
        raise NotFoundException(f"One or more {label} not found")


async def _sub_agent_rows(
    user_id: str, project_id: uuid.UUID, ids: list[uuid.UUID], session: AsyncSession
) -> list[AgentProfileModel]:
    rows = await session.scalars(
        select_owned_agent_profiles(user_id)
        .where(
            AgentProfileModel.sub_agent.is_(True),
            AgentProfileModel.id.in_(ids),
            AgentProfileModel.id.in_(selected_agent_ids(user_id=user_id, project_id=project_id)),
        )
        .order_by(AgentProfileModel.name, AgentProfileModel.id)
    )
    result = list(rows)
    _require_all(ids, result, "sub-agents")
    return result


async def _vision_model_ids(user_id: str, rows: list[AgentProfileModel], session: AsyncSession) -> set[uuid.UUID]:
    models = await session.scalars(
        select_visible_models(user_id).where(
            LLMModel.id.in_([row.model_id for row in rows]), LLMModel.supports_vision.is_(True)
        )
    )
    return {model.id for model in models}


def _sub_agent_item(key: str, row: AgentProfileModel, needs_vision: bool, skill_keys: list[str]) -> dict:
    tools = list(dict.fromkeys(configurable_tools(row.tools)))
    parameters = row.chat_parameters or {}
    return {
        "key": key,
        "name": row.name,
        "description": row.description,
        "instructions": row.system_prompt,
        "max_steps": row.max_steps,
        "generation": {name: parameters[name] for name in GenerationDefaults.model_fields if name in parameters},
        "requested_tools": tools,
        "requested_skills": skill_keys,
        # Vision cannot be read from the configuration, so the bound model's
        # support is kept. A context window would overstate the need, so it is
        # not. Skills are loaded with a tool, so they need tool support too.
        "model_requirements": {"tools": bool(tools or skill_keys), "vision": needs_vision},
    }


async def _sub_agent_items(
    user_id: str, project_id: uuid.UUID, ids: list[uuid.UUID], skill_keys: dict[uuid.UUID, str], session: AsyncSession
) -> list[dict]:
    """Sub-agents with requests for those of their assigned skills the pack also carries."""
    rows = await _sub_agent_rows(user_id, project_id, ids, session)
    vision = await _vision_model_ids(user_id, rows, session)
    assignments = await session.execute(
        select_owned_assignments(user_id)
        .with_only_columns(AgentSkillModel.agent_id, AgentSkillModel.skill_id)
        .where(
            AgentSkillModel.sub_agent.is_(True),
            AgentSkillModel.agent_id.in_([row.id for row in rows]),
            AgentSkillModel.skill_id.in_(list(skill_keys)),
        )
    )
    requested: dict[uuid.UUID, set[str]] = {}
    for agent_id, skill_id in assignments:
        requested.setdefault(agent_id, set()).add(skill_keys[skill_id])
    return [
        _sub_agent_item(
            f"sub-agent-{index}",
            row,
            row.model_id in vision,
            sorted(requested.get(row.id, ()), key=lambda key: int(key.removeprefix("skill-"))),
        )
        for index, row in enumerate(rows, start=1)
    ]


async def _skill_rows(user_id: str, ids: list[uuid.UUID], session: AsyncSession) -> list[SkillModel]:
    rows = list(
        await session.scalars(
            select_owned_skills(user_id).where(SkillModel.id.in_(ids)).order_by(SkillModel.name, SkillModel.id)
        )
    )
    _require_all(ids, rows, "skills")
    return rows


async def _skill_items(user_id: str, rows: list[SkillModel], session: AsyncSession) -> list[dict]:
    main_assigned = set(
        await session.scalars(
            select_owned_assignments(user_id)
            .with_only_columns(AgentSkillModel.skill_id)
            .where(AgentSkillModel.sub_agent.is_(False), AgentSkillModel.skill_id.in_([row.id for row in rows]))
        )
    )
    return [
        {"key": f"skill-{index}", "content": row.content, "request_main_agent_assignment": row.id in main_assigned}
        for index, row in enumerate(rows, start=1)
    ]


async def _document_items(
    statement, ids: list[uuid.UUID], label: str, key_prefix: str, session: AsyncSession
) -> list[dict]:
    rows = list(
        await session.scalars(
            statement.where(PromptTemplateModel.id.in_(ids)).order_by(PromptTemplateModel.name, PromptTemplateModel.id)
        )
    )
    _require_all(ids, rows, label)
    return [
        {"key": f"{key_prefix}-{index}", "document": json.loads(row.document)}
        for index, row in enumerate(rows, start=1)
    ]


def _project_item(project: Project, sub_agents: list[dict]) -> dict:
    return {
        "name": project.name,
        "description": project.description,
        "system_prompt": project.system_prompt,
        "accent": project.accent,
        "goal": project.goal,
        "areas": project.areas.model_dump(),
        "sub_agents": [agent["key"] for agent in sub_agents],
    }


async def export_pack(
    *, user_id: str, project_id: uuid.UUID, payload: PackExportRequest, session: AsyncSession
) -> PackManifest:
    """Build the chosen items into a validated pack; foreign IDs are 404."""
    project = await get_project(user_id=user_id, project_id=project_id, session=session)
    skill_rows = await _skill_rows(user_id, payload.skill_ids, session)
    skill_keys = {row.id: f"skill-{index}" for index, row in enumerate(skill_rows, start=1)}
    sub_agents = await _sub_agent_items(user_id, project_id, payload.sub_agent_ids, skill_keys, session)
    data = {
        "format": PACK_FORMAT,
        "format_version": PACK_FORMAT_VERSION,
        "pack": {
            "id": pack_id(payload.name),
            "version": payload.version,
            "name": payload.name,
            "description": payload.description,
        },
        "sub_agents": sub_agents,
        "skills": await _skill_items(user_id, skill_rows, session),
        "templates": await _document_items(
            select_owned_templates(user_id), payload.template_ids, "templates", "template", session
        ),
        "rubrics": await _document_items(
            select_owned_rubrics(user_id), payload.rubric_ids, "rubrics", "rubric", session
        ),
        "project": _project_item(project, sub_agents) if payload.include_project_settings else None,
    }
    return parse_pack(json.dumps(data, ensure_ascii=False).encode("utf-8"))
