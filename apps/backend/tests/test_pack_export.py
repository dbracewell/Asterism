"""US-59.2: exporting a project's agent setup as a validated team pack."""

import uuid

import pytest
import pytest_asyncio
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.packs.documents import parse_pack
from asterism.domains.packs.export import pack_id
from asterism.domains.projects.models import ProjectSubAgentModel
from asterism.domains.prompt_templates.documents import parse_document as parse_template
from asterism.domains.prompt_templates.documents import serialize_document
from asterism.domains.prompt_templates.models import PromptTemplateModel, TemplateKind
from asterism.domains.prompt_templates.rubrics import parse_rubric, serialize_rubric
from asterism.domains.settings.models import LLMModel
from asterism.domains.skills.models import AgentSkillModel, SkillModel
from sqlalchemy import select, update
from test_pack_documents import RUBRIC, SKILL, TEMPLATE
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
MODEL = uuid.UUID(int=1)
VISION_MODEL = uuid.UUID(int=2)
SECRET = "sk-" + "a1B2" * 12


def agent(user="a", name="Researcher", model=MODEL, **overrides):
    values = {
        "id": uuid.uuid4(),
        "user_id": user,
        "sub_agent": True,
        "model_id": model,
        "name": name,
        "description": "Finds sources.",
        "system_prompt": "Find sources.",
        "max_steps": 7,
        "chat_parameters": {"temperature": 0.2},
        "tools": ["web_search", "sub_agent"],
    }
    return AgentProfileModel(**{**values, **overrides})


def document_row(kind, document, user="a"):
    serialize = serialize_document if kind is TemplateKind.PROMPT else serialize_rubric
    parsed = parse_template(document) if kind is TemplateKind.PROMPT else parse_rubric(document)
    return PromptTemplateModel(
        id=uuid.uuid4(),
        user_id=user,
        kind=kind,
        name=parsed.name,
        description=parsed.description,
        document=serialize(parsed),
    )


@pytest_asyncio.fixture
async def setup(project_api):
    client, sessions, _ = project_api
    created = await client.post(
        "/projects/",
        headers=auth(),
        json={"name": "Research", "system_prompt": "Stay rigorous.", "accent": "teal", "goal": "Finish the review"},
    )
    project = created.json()["id"]
    researcher, critic = agent(), agent(name="Critic", model=VISION_MODEL, tools=[])
    unselected = agent(name="Unselected")
    skill = SkillModel(id=uuid.uuid4(), user_id="a", name="cite-sources", description="Cite.", content=SKILL)
    other_skill = SkillModel(
        id=uuid.uuid4(), user_id="a", name="other", description="Other.", content=SKILL.replace("cite-sources", "other")
    )
    template = document_row(TemplateKind.PROMPT, TEMPLATE)
    rubric = document_row(TemplateKind.RUBRIC, RUBRIC)
    async with sessions() as session:
        main = await session.scalar(
            select(AgentProfileModel.id).where(AgentProfileModel.user_id == "a", AgentProfileModel.sub_agent.is_(False))
        )
        session.add_all([researcher, critic, unselected, skill, other_skill, template, rubric])
        await session.flush()
        await session.execute(update(LLMModel).where(LLMModel.id == VISION_MODEL).values(supports_vision=True))
        session.add_all(
            [
                ProjectSubAgentModel(project_id=uuid.UUID(project), agent_id=researcher.id, user_id="a"),
                ProjectSubAgentModel(project_id=uuid.UUID(project), agent_id=critic.id, user_id="a"),
                AgentSkillModel(agent_id=main, skill_id=skill.id, user_id="a"),
            ]
        )
        await session.commit()
    return {
        "client": client,
        "sessions": sessions,
        "url": f"/projects/{project}/pack-export",
        "researcher": str(researcher.id),
        "critic": str(critic.id),
        "unselected": str(unselected.id),
        "skill": str(skill.id),
        "other_skill": str(other_skill.id),
        "template": str(template.id),
        "rubric": str(rubric.id),
    }


def everything(setup):
    return {
        "name": "Research team",
        "description": "Research, then critique.",
        "sub_agent_ids": [setup["researcher"], setup["critic"]],
        "skill_ids": [setup["skill"], setup["other_skill"]],
        "template_ids": [setup["template"]],
        "rubric_ids": [setup["rubric"]],
        "include_project_settings": True,
    }


async def test_export_round_trips_through_the_parser(setup):
    response = await setup["client"].post(setup["url"], headers=auth(), json=everything(setup))
    assert response.status_code == 200
    manifest = parse_pack(response.content)
    assert (manifest.pack.id, manifest.pack.version) == ("research-team", "1.0.0")
    assert [item.name for item in manifest.sub_agents] == ["Critic", "Researcher"]
    critic, researcher = manifest.sub_agents
    assert researcher.instructions == "Find sources." and researcher.max_steps == 7
    assert researcher.generation.temperature == 0.2
    assert researcher.requested_tools == ("web_search",)
    assert researcher.model_requirements.tools and not researcher.model_requirements.vision
    assert critic.model_requirements.vision and not critic.model_requirements.tools
    assert [skill.request_main_agent_assignment for skill in manifest.skills] == [True, False]
    assert manifest.templates[0].document.name == TEMPLATE["name"]
    assert manifest.rubrics[0].document.name == RUBRIC["name"]
    project = manifest.project
    assert project is not None
    assert (project.name, project.system_prompt, project.accent) == ("Research", "Stay rigorous.", "teal")
    assert project.sub_agents == ("sub-agent-1", "sub-agent-2")


async def test_only_chosen_items_are_exported(setup):
    payload = {"name": "Just a rubric", "rubric_ids": [setup["rubric"]]}
    response = await setup["client"].post(setup["url"], headers=auth(), json=payload)
    manifest = parse_pack(response.content)
    assert len(manifest.rubrics) == 1
    assert not (manifest.sub_agents or manifest.skills or manifest.templates or manifest.project)


async def test_export_holds_no_ids_or_provider_data(setup):
    response = await setup["client"].post(setup["url"], headers=auth(), json=everything(setup))
    for value in (str(MODEL), str(VISION_MODEL), setup["researcher"], setup["skill"], setup["template"], "Chat A"):
        assert value not in response.text
    assert "model_id" not in response.text and "user_id" not in response.text


async def test_generation_extras_are_not_exported(setup):
    parameters = {"temperature": 0.5, "extra_body": {"api_key": SECRET}, "logit_bias": {"1": 1}}
    async with setup["sessions"]() as session:
        await session.execute(
            update(AgentProfileModel)
            .where(AgentProfileModel.id == uuid.UUID(setup["researcher"]))
            .values(chat_parameters=parameters)
        )
        await session.commit()
    response = await setup["client"].post(setup["url"], headers=auth(), json=everything(setup))
    assert response.status_code == 200
    assert SECRET not in response.text and "extra_body" not in response.text


async def test_credentials_in_instructions_stop_the_export_without_being_echoed(setup):
    async with setup["sessions"]() as session:
        await session.execute(
            update(AgentProfileModel)
            .where(AgentProfileModel.id == uuid.UUID(setup["researcher"]))
            .values(system_prompt=f"Use {SECRET}.")
        )
        await session.commit()
    response = await setup["client"].post(setup["url"], headers=auth(), json=everything(setup))
    assert response.status_code == 400
    assert "looks like a credential" in response.text and SECRET not in response.text


async def test_export_changes_nothing(setup):
    async with setup["sessions"]() as session:
        before = (await session.scalars(select(AgentProfileModel.config_revision))).all()
    await setup["client"].post(setup["url"], headers=auth(), json=everything(setup))
    async with setup["sessions"]() as session:
        assert (await session.scalars(select(AgentProfileModel.config_revision))).all() == before


@pytest.mark.parametrize("field", ["skill_ids", "template_ids", "rubric_ids", "sub_agent_ids"])
async def test_foreign_or_unknown_items_are_404(setup, field):
    payload = {"name": "Pack", field: [str(uuid.uuid4())]}
    assert (await setup["client"].post(setup["url"], headers=auth(), json=payload)).status_code == 404


async def test_foreign_owner_cannot_read_the_project_or_items(setup):
    response = await setup["client"].post(setup["url"], headers=auth("b"), json=everything(setup))
    assert response.status_code == 404
    created = await setup["client"].post("/projects/", headers=auth("b"), json={"name": "Mine"})
    url = f"/projects/{created.json()['id']}/pack-export"
    payload = {"name": "Pack", "skill_ids": [setup["skill"]]}
    assert (await setup["client"].post(url, headers=auth("b"), json=payload)).status_code == 404


async def test_kinds_do_not_cross(setup):
    payload = {"name": "Pack", "template_ids": [setup["rubric"]]}
    assert (await setup["client"].post(setup["url"], headers=auth(), json=payload)).status_code == 404


async def test_sub_agents_must_be_selected_on_the_project(setup):
    payload = {"name": "Pack", "sub_agent_ids": [setup["unselected"]]}
    assert (await setup["client"].post(setup["url"], headers=auth(), json=payload)).status_code == 404


async def test_duplicate_selections_and_empty_packs_are_rejected(setup):
    payload = {"name": "Pack", "skill_ids": [setup["skill"], setup["skill"]]}
    assert (await setup["client"].post(setup["url"], headers=auth(), json=payload)).status_code == 400
    empty = await setup["client"].post(setup["url"], headers=auth(), json={"name": "Pack"})
    assert empty.status_code == 400 and "at least one item" in empty.text


async def test_export_requires_auth(setup):
    assert (await setup["client"].post(setup["url"], json={"name": "Pack"})).status_code == 401


@pytest.mark.parametrize(
    ("name", "expected"),
    [("Research Team!", "research-team"), ("  ---  ", "team-pack"), ("研究", "team-pack"), ("a" * 150, "a" * 100)],
)
async def test_pack_id_is_a_valid_slug(name, expected):
    assert pack_id(name) == expected
