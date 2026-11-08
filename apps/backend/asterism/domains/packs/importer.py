"""Create records from a reviewed pack in one transaction (US-59.3).

Importing grants nothing by itself. The user decides every item, picks every
model and approves every assignment, and all of it is checked again here because
tools, models and policy can change after review. Errors name the item key, not
pack text. Any failure leaves nothing behind.
"""

import json
import uuid
from collections.abc import Iterable, Sequence

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.schemas import SubAgentCreate
from asterism.domains.agent.service import new_sub_agent
from asterism.domains.chatgpt.availability import available_user_model
from asterism.domains.projects.models import ProjectModel, ProjectSubAgentModel
from asterism.domains.projects.schemas import ProjectSettings
from asterism.domains.prompt_templates.documents import parse_document as parse_template
from asterism.domains.prompt_templates.documents import serialize_document
from asterism.domains.prompt_templates.models import PromptTemplateModel
from asterism.domains.prompt_templates.rubric_service import new_rubric
from asterism.domains.prompt_templates.rubrics import parse_rubric, serialize_rubric
from asterism.domains.prompt_templates.service import new_template
from asterism.domains.skills.assignments import add_assignments
from asterism.domains.skills.documents import parse_document as parse_skill
from asterism.domains.skills.documents import rename_document
from asterism.domains.skills.models import SkillModel
from asterism.domains.skills.policy import read_policy
from asterism.domains.skills.service import new_skill

from .documents import PackManifest, PackSkill, PackSubAgent, check_item, folded_name
from .models import PackImportItemModel, PackImportModel, PackItemType
from .review import ExistingNames, available_tools, existing_names, parse_pack_text
from .schemas import (
    PackImportRequest,
    PackImportResult,
    PackItemDecision,
    PackSkillDecision,
    PackSubAgentDecision,
)

logger = get_logger("PackImport")


def _decisions[D: PackItemDecision](keys: Iterable[str], decisions: Sequence[D], label: str) -> dict[str, D]:
    """Every item needs exactly one decision, so a stale client cannot drop any."""
    by_key = {decision.key: decision for decision in decisions}
    if len(by_key) != len(decisions) or set(by_key) != set(keys):
        raise BadDataException(f"Decide every pack {label} exactly once")
    return by_key


def _final_name(key: str, name: str, taken: set[str]) -> None:
    """Claim a name, so a clash is resolved by the user and never by a suffix."""
    folded = folded_name(name)
    if folded in taken:
        raise ConflictException(f"Pack item '{key}': name is already in use; rename or skip it")
    taken.add(folded)


async def _build_sub_agent(
    user_id: str,
    agent: PackSubAgent,
    decision: PackSubAgentDecision,
    tools: frozenset[str],
    taken: set[str],
    session: AsyncSession,
) -> AgentProfileModel:
    name = decision.name or agent.name
    _final_name(agent.key, name, taken)
    if decision.model_id is None:
        raise BadDataException(f"Pack item '{agent.key}': choose a model")
    approved = decision.approved_tools
    if len(set(approved)) != len(approved) or set(approved) - set(agent.requested_tools):
        raise BadDataException(f"Pack item '{agent.key}': approve only tools the pack requests, once each")
    if set(approved) - tools:
        raise BadDataException(f"Pack item '{agent.key}': an approved tool is not available here")
    model = await available_user_model(user_id, decision.model_id, session)
    if model is None:
        raise BadDataException(f"Pack item '{agent.key}': the chosen model is not available")
    if approved and model.supports_tools is not True:
        raise BadDataException(f"Pack item '{agent.key}': the chosen model does not support tools")
    return await new_sub_agent(
        user_id,
        SubAgentCreate(
            name=name,
            description=agent.description,
            model_id=model.id,
            system_prompt=agent.instructions,
            max_steps=agent.max_steps,
            tools=approved,
            chat_parameters=agent.generation,
        ),
        session,
    )


def _build_skill(user_id: str, skill: PackSkill, decision: PackSkillDecision, taken: set[str]) -> SkillModel:
    content = skill.content
    if decision.name:
        content = check_item(skill.key, content, lambda text: rename_document(text, decision.name or ""))
    _final_name(skill.key, parse_skill(content).name, taken)
    if decision.assign_to_main_agent and not skill.request_main_agent_assignment:
        raise BadDataException(f"Pack item '{skill.key}': the pack does not request this assignment")
    return new_skill(user_id, content)


def _build_template(user_id: str, item, decision: PackItemDecision, taken: set[str]) -> PromptTemplateModel:
    data = json.loads(serialize_document(item.document))
    document = check_item(item.key, data | {"name": decision.name or data["name"]}, parse_template)
    _final_name(item.key, document.name, taken)
    return new_template(user_id, document)


def _build_rubric(user_id: str, item, decision: PackItemDecision, taken: set[str]) -> PromptTemplateModel:
    data = json.loads(serialize_rubric(item.document))
    document = check_item(item.key, data | {"name": decision.name or data["name"]}, parse_rubric)
    _final_name(item.key, document.name, taken)
    return new_rubric(user_id, document)


def _build_project(user_id: str, manifest: PackManifest, payload: PackImportRequest, names: ExistingNames):
    project, decision = manifest.project, payload.project
    if (project is None) != (decision is None):
        raise BadDataException("Decide the pack project exactly once")
    if project is None or decision is None or not decision.include:
        return None
    name = decision.name or project.name
    _final_name("project", name, set(names.projects))
    values = ProjectSettings(
        name=name,
        description=project.description,
        system_prompt=project.system_prompt,
        accent=project.accent,
        goal=project.goal,
        areas=project.areas,
    )
    return ProjectModel(user_id=user_id, **values.model_dump())


def _provenance(
    manifest: PackManifest, user_id: str, items: list[tuple[PackItemType, str | None, uuid.UUID]]
) -> tuple[PackImportModel, list[PackImportItemModel]]:
    record = PackImportModel(
        id=uuid.uuid4(),
        user_id=user_id,
        pack_id=manifest.pack.id,
        pack_version=manifest.pack.version,
        pack_name=manifest.pack.name,
    )
    rows = [
        PackImportItemModel(import_id=record.id, item_type=kind, item_key=key, record_id=record_id)
        for kind, key, record_id in items
    ]
    return record, rows


async def import_pack(*, user_id: str, payload: PackImportRequest, session: AsyncSession) -> PackImportResult:
    """Create the chosen items, or nothing at all."""
    manifest = parse_pack_text(payload.source)
    agent_choices = _decisions((item.key for item in manifest.sub_agents), payload.sub_agents, "sub-agent")
    skill_choices = _decisions((item.key for item in manifest.skills), payload.skills, "skill")
    template_choices = _decisions((item.key for item in manifest.templates), payload.templates, "template")
    rubric_choices = _decisions((item.key for item in manifest.rubrics), payload.rubrics, "rubric")
    names = await existing_names(user_id, session)
    tools = await available_tools(session)

    taken = set(names.sub_agents)
    agents = {
        item.key: await _build_sub_agent(user_id, item, agent_choices[item.key], tools, taken, session)
        for item in manifest.sub_agents
        if agent_choices[item.key].include
    }
    taken = set(names.skills)
    skills = {
        item.key: _build_skill(user_id, item, skill_choices[item.key], taken)
        for item in manifest.skills
        if skill_choices[item.key].include
    }
    assigned = [key for key in skills if skill_choices[key].assign_to_main_agent]
    if assigned and not (await read_policy(session)).enabled:
        raise BadDataException("Skills are turned off by your administrator, so they cannot be assigned")
    taken = set(names.templates)
    templates = {
        item.key: _build_template(user_id, item, template_choices[item.key], taken)
        for item in manifest.templates
        if template_choices[item.key].include
    }
    taken = set(names.rubrics)
    rubrics = {
        item.key: _build_rubric(user_id, item, rubric_choices[item.key], taken)
        for item in manifest.rubrics
        if rubric_choices[item.key].include
    }
    project = _build_project(user_id, manifest, payload, names)
    if not (agents or skills or templates or rubrics or project):
        raise BadDataException("Choose at least one item to import")

    try:
        session.add_all([*agents.values(), *skills.values(), *templates.values(), *rubrics.values()])
        if project is not None:
            session.add(project)
        await session.flush()
        if assigned:
            await add_assignments(user_id, [skills[key].id for key in assigned], session)
        if project is not None and manifest.project is not None:
            session.add_all(
                [
                    ProjectSubAgentModel(project_id=project.id, agent_id=agents[key].id, user_id=user_id)
                    for key in manifest.project.sub_agents
                    if key in agents
                ]
            )
        items = [
            *((PackItemType.SUB_AGENT, key, row.id) for key, row in agents.items()),
            *((PackItemType.SKILL, key, row.id) for key, row in skills.items()),
            *((PackItemType.TEMPLATE, key, row.id) for key, row in templates.items()),
            *((PackItemType.RUBRIC, key, row.id) for key, row in rubrics.items()),
            *([(PackItemType.PROJECT, None, project.id)] if project is not None else []),
        ]
        record, item_rows = _provenance(manifest, user_id, items)
        session.add(record)
        await session.flush()
        session.add_all(item_rows)
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictException("A record changed during import; review the pack again") from exc
    except Exception:
        await session.rollback()
        raise
    logger.info(f"Imported pack {manifest.pack.id} {manifest.pack.version} for user {user_id}")
    return PackImportResult(
        import_id=record.id,
        sub_agent_ids=[row.id for row in agents.values()],
        skill_ids=[row.id for row in skills.values()],
        template_ids=[row.id for row in templates.values()],
        rubric_ids=[row.id for row in rubrics.values()],
        project_id=project.id if project is not None else None,
    )
