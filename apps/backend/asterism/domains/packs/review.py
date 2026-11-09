"""Describe what a pack asks for (US-59.3). Reading a pack changes nothing.

Pack text is untrusted: it is returned as data for the user to read and is never
interpreted here. Availability reflects this installation at review time, so
import checks everything again.
"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.queries import select_owned_agent_profiles
from asterism.domains.chatgpt.availability import ModelAvailability
from asterism.domains.projects.models import ProjectModel
from asterism.domains.projects.queries import select_owned_projects
from asterism.domains.prompt_templates.models import PromptTemplateModel
from asterism.domains.prompt_templates.queries import select_owned_rubrics, select_owned_templates
from asterism.domains.settings.models import LLMModel
from asterism.domains.settings.queries import select_visible_models
from asterism.domains.settings.tool_settings import get_tool_settings
from asterism.domains.skills.documents import parse_document as parse_skill
from asterism.domains.skills.models import SkillModel
from asterism.domains.skills.policy import read_policy
from asterism.domains.skills.queries import select_owned_skills
from asterism.domains.tools.registry import tool_registry

from .documents import ModelRequirements, PackManifest, folded_name, parse_pack
from .schemas import (
    PackModelOption,
    PackProjectReview,
    PackReview,
    PackRubricReview,
    PackSkillReview,
    PackSubAgentReview,
    PackTemplateReview,
    PackToolRequest,
)


def parse_pack_text(source: str) -> PackManifest:
    """The request boundary already refuses text that cannot encode as UTF-8."""
    return parse_pack(source.encode("utf-8"))


@dataclass(frozen=True)
class ExistingNames:
    """The user's record names, folded the way pack names are compared."""

    sub_agents: frozenset[str]
    skills: frozenset[str]
    templates: frozenset[str]
    rubrics: frozenset[str]
    projects: frozenset[str]


async def _names(statement, column, session: AsyncSession) -> frozenset[str]:
    return frozenset(folded_name(name) for name in await session.scalars(statement.with_only_columns(column)))


async def existing_names(user_id: str, session: AsyncSession) -> ExistingNames:
    return ExistingNames(
        sub_agents=await _names(
            select_owned_agent_profiles(user_id).where(AgentProfileModel.sub_agent.is_(True)),
            AgentProfileModel.name,
            session,
        ),
        skills=await _names(select_owned_skills(user_id), SkillModel.name, session),
        templates=await _names(select_owned_templates(user_id), PromptTemplateModel.name, session),
        rubrics=await _names(select_owned_rubrics(user_id), PromptTemplateModel.name, session),
        projects=await _names(select_owned_projects(user_id=user_id), ProjectModel.name, session),
    )


async def available_tools(session: AsyncSession) -> frozenset[str]:
    """Tools admin policy allows here; the same rule a saved sub-agent must meet."""
    settings = await get_tool_settings(session=session)
    return frozenset(settings.active_tools) & frozenset(tool_registry.registry)


def unmet_requirements(requirements: ModelRequirements, model: LLMModel) -> list:
    """Unknown capabilities count as unmet, matching the explicit tool check."""
    unmet = []
    if requirements.tools and model.supports_tools is not True:
        unmet.append("tools")
    if requirements.vision and model.supports_vision is not True:
        unmet.append("vision")
    minimum = requirements.min_context_window
    if minimum is not None and (model.context_window is None or model.context_window < minimum):
        unmet.append("context_window")
    return unmet


async def _available_models(user_id: str, session: AsyncSession) -> list[LLMModel]:
    availability = await ModelAvailability.load(user_id, session)
    rows = await session.scalars(select_visible_models(user_id).order_by(LLMModel.name, LLMModel.id))
    return [row for row in rows if availability.reason(row) is None]


async def review_pack(*, user_id: str, source: str, session: AsyncSession) -> PackReview:
    manifest = parse_pack_text(source)
    names = await existing_names(user_id, session)
    tools = await available_tools(session)
    models = await _available_models(user_id, session)
    skills_enabled = (await read_policy(session)).enabled
    sub_agents = [
        PackSubAgentReview(
            key=agent.key,
            name=agent.name,
            description=agent.description,
            instructions=agent.instructions,
            max_steps=agent.max_steps,
            generation=agent.generation,
            requested_tools=[PackToolRequest(name=name, available=name in tools) for name in agent.requested_tools],
            requested_skills=list(agent.requested_skills),
            model_requirements=agent.model_requirements,
            model_options=[
                PackModelOption(
                    id=model.id,
                    name=model.display_name or model.name,
                    provider_name=model.provider.name,
                    unmet_requirements=unmet_requirements(agent.model_requirements, model),
                )
                for model in models
            ],
            name_conflict=folded_name(agent.name) in names.sub_agents,
        )
        for agent in manifest.sub_agents
    ]
    skills = []
    for skill in manifest.skills:
        metadata = parse_skill(skill.content)
        skills.append(
            PackSkillReview(
                key=skill.key,
                name=metadata.name,
                description=metadata.description,
                content=skill.content,
                assignment_requested=skill.request_main_agent_assignment,
                assignment_allowed=skills_enabled,
                name_conflict=folded_name(metadata.name) in names.skills,
            )
        )
    project = manifest.project
    return PackReview(
        pack=manifest.pack,
        sub_agents=sub_agents,
        skills=skills,
        templates=[
            PackTemplateReview(
                key=item.key,
                name=item.document.name,
                document=item.document,
                name_conflict=folded_name(item.document.name) in names.templates,
            )
            for item in manifest.templates
        ],
        rubrics=[
            PackRubricReview(
                key=item.key,
                name=item.document.name,
                document=item.document,
                name_conflict=folded_name(item.document.name) in names.rubrics,
            )
            for item in manifest.rubrics
        ],
        project=PackProjectReview(
            **project.model_dump(),
            name_conflict=folded_name(project.name) in names.projects,
        )
        if project is not None
        else None,
    )
