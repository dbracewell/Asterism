"""US-59.3: reviewing a pack and creating its items in one transaction."""

import json
import uuid

import pytest
import pytest_asyncio
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.packs.models import PackImportItemModel, PackImportModel, PackItemType
from asterism.domains.projects.models import ProjectModel, ProjectSubAgentModel
from asterism.domains.prompt_templates.models import PromptTemplateModel
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel
from asterism.domains.skills.documents import parse_document, rename_document
from asterism.domains.skills.models import AgentSkillModel, SkillModel
from asterism.domains.tools.registry import tool_registry
from sqlalchemy import func, select, update
from test_pack_documents import SKILL, manifest
from test_pack_export import everything
from test_pack_export import setup as _export_setup
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
export_setup = _export_setup
TOOL_MODEL = uuid.UUID(int=1)
PLAIN_MODEL = uuid.UUID(int=2)
TABLES = (AgentProfileModel, SkillModel, PromptTemplateModel, ProjectModel, AgentSkillModel, PackImportModel)


def source(data=None):
    return json.dumps(data if data is not None else manifest())


def decisions(data=None, **overrides):
    """A complete import request that takes every item with no assignments."""
    pack = data if data is not None else manifest()
    body = {
        "source": source(pack),
        "sub_agents": [
            {"key": item["key"], "include": True, "model_id": str(TOOL_MODEL)} for item in pack["sub_agents"]
        ],
        "skills": [{"key": item["key"], "include": True} for item in pack["skills"]],
        "templates": [{"key": item["key"], "include": True} for item in pack["templates"]],
        "rubrics": [{"key": item["key"], "include": True} for item in pack["rubrics"]],
        "project": {"include": True} if pack.get("project") else None,
    }
    return body | overrides


async def counts(sessions):
    async with sessions() as session:
        return [await session.scalar(select(func.count()).select_from(table)) for table in TABLES]


@pytest_asyncio.fixture
async def api(project_api, monkeypatch):
    client, sessions, _ = project_api
    monkeypatch.setitem(tool_registry.registry, "web_search", object())
    async with sessions() as session:
        await session.execute(update(LLMModel).where(LLMModel.id == TOOL_MODEL).values(supports_tools=True))
        session.add_all(
            [
                ApplicationSettingsModel(key="active_tools", value=["web_search"]),
                ApplicationSettingsModel(key="skills_enabled", value=True),
            ]
        )
        await session.commit()
    # Provision the main agent before counting records.
    await client.get("/projects/", headers=auth())
    return client, sessions


async def post_import(client, body, user="a"):
    return await client.post("/team-packs/import", headers=auth(user), json=body)


async def test_review_lists_everything_and_creates_nothing(api):
    client, sessions = api
    before = await counts(sessions)
    response = await client.post("/team-packs/review", headers=auth(), json={"source": source()})
    assert response.status_code == 200, response.text
    review = response.json()
    assert review["pack"]["id"] == "research-team"
    agent = review["sub_agents"][0]
    assert agent["instructions"] == manifest()["sub_agents"][0]["instructions"]
    assert agent["requested_tools"] == [{"name": "web_search", "available": True}]
    assert review["skills"][0]["content"] == SKILL
    assert review["skills"][0]["assignment_allowed"] is True
    assert review["templates"][0]["name"] == "Summary"
    assert review["rubrics"][0]["name"] == "Essay"
    assert review["project"]["sub_agents"] == manifest()["project"]["sub_agents"]
    assert await counts(sessions) == before


async def test_review_marks_unmet_requirements_and_policy_limits(api):
    client, sessions = api
    async with sessions() as session:
        await session.execute(
            update(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "active_tools").values(value=[])
        )
        await session.execute(
            update(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "skills_enabled").values(value=False)
        )
        await session.commit()
    pack = manifest()
    pack["sub_agents"][0]["model_requirements"] = {"tools": True, "vision": True, "min_context_window": 1000}
    review = (await client.post("/team-packs/review", headers=auth(), json={"source": source(pack)})).json()
    agent = review["sub_agents"][0]
    assert agent["requested_tools"] == [{"name": "web_search", "available": False}]
    options = {option["id"]: option["unmet_requirements"] for option in agent["model_options"]}
    assert options[str(TOOL_MODEL)] == ["vision", "context_window"]
    assert options[str(PLAIN_MODEL)] == ["tools", "vision", "context_window"]
    assert review["skills"][0]["assignment_allowed"] is False


async def test_review_offers_only_available_models(api):
    client, sessions = api
    async with sessions() as session:
        await session.execute(update(LLMModel).where(LLMModel.id == PLAIN_MODEL).values(is_active=False))
        await session.commit()
    review = (await client.post("/team-packs/review", headers=auth(), json={"source": source()})).json()
    assert [option["id"] for option in review["sub_agents"][0]["model_options"]] == [str(TOOL_MODEL)]


@pytest.mark.parametrize("path", ["/team-packs/review", "/team-packs/import"])
async def test_rejects_invalid_packs_without_echoing_them(api, path):
    client, sessions = api
    secret = "sk-" + "a1B2" * 12
    pack = manifest()
    pack["sub_agents"][0]["instructions"] = secret
    body = {"source": source(pack)}
    response = await client.post(path, headers=auth(), json=body)
    assert response.status_code == 400
    assert secret not in response.text
    surrogate = await client.post(
        path,
        headers={**auth(), "content-type": "application/json"},
        content=b'{"source": "\\ud800"}',
    )
    assert surrogate.status_code == 422
    oversized = await client.post(path, headers=auth(), json={"source": secret + "x" * (1 << 20)})
    assert oversized.status_code == 422
    assert secret not in oversized.text


async def test_routes_need_authentication(api):
    client, _ = api
    assert (await client.post("/team-packs/review", json={"source": source()})).status_code == 401
    assert (await client.post("/team-packs/import", json=decisions())).status_code == 401


async def test_import_creates_owned_records_and_grants_nothing_by_default(api):
    client, sessions = api
    response = await post_import(client, decisions())
    assert response.status_code == 200, response.text
    result = response.json()
    async with sessions() as session:
        agent = await session.get(AgentProfileModel, uuid.UUID(result["sub_agent_ids"][0]))
        assert (agent.user_id, agent.model_id, agent.tools) == ("a", TOOL_MODEL, [])
        assert agent.sub_agent is True
        assert agent.system_prompt == manifest()["sub_agents"][0]["instructions"]
        assert agent.max_steps == 8
        assert agent.chat_parameters == {"temperature": 1, "max_tokens": 2000}
        assert await session.scalar(select(func.count()).select_from(AgentSkillModel)) == 0
        project = await session.get(ProjectModel, uuid.UUID(result["project_id"]))
        assert project.user_id == "a"
        selected = await session.scalars(
            select(ProjectSubAgentModel.agent_id).where(ProjectSubAgentModel.project_id == project.id)
        )
        assert [str(agent_id) for agent_id in selected] == result["sub_agent_ids"][:1]


async def test_import_records_pack_provenance(api):
    client, sessions = api
    result = (await post_import(client, decisions())).json()
    async with sessions() as session:
        record = await session.get(PackImportModel, uuid.UUID(result["import_id"]))
        assert (record.user_id, record.pack_id, record.pack_version) == ("a", "research-team", "1.2.0")
        items = list(
            await session.scalars(select(PackImportItemModel).where(PackImportItemModel.import_id == record.id))
        )
    assert {item.item_type for item in items} == set(PackItemType)
    assert str(next(i.record_id for i in items if i.item_type is PackItemType.PROJECT)) == result["project_id"]


async def test_import_applies_only_approved_capabilities(api):
    client, sessions = api
    body = decisions()
    body["sub_agents"][0]["approved_tools"] = ["web_search"]
    body["skills"][0]["assign_to_main_agent"] = True
    data = manifest()
    data["skills"][0]["request_main_agent_assignment"] = True
    body["source"] = source(data)
    async with sessions() as session:
        main = await session.scalar(select(AgentProfileModel).where(AgentProfileModel.sub_agent.is_(False)))
        revision = main.config_revision
    result = await post_import(client, body)
    assert result.status_code == 200, result.text
    async with sessions() as session:
        agent = await session.get(AgentProfileModel, uuid.UUID(result.json()["sub_agent_ids"][0]))
        assert agent.tools == ["web_search"]
        assignment = await session.scalar(select(AgentSkillModel))
        assert str(assignment.skill_id) == result.json()["skill_ids"][0]
        main = await session.scalar(select(AgentProfileModel).where(AgentProfileModel.sub_agent.is_(False)))
        assert main.config_revision == revision + 1


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda body: body["sub_agents"][0].update(model_id=None), "choose a model"),
        (lambda body: body["sub_agents"][0].update(model_id=str(uuid.uuid4())), "not available"),
        (lambda body: body["sub_agents"][0].update(approved_tools=["image_generation"]), "pack requests"),
        (lambda body: body["sub_agents"][0].update(approved_tools=["web_search"] * 2), "pack requests"),
        (lambda body: body["sub_agents"].pop(), "exactly once"),
        (lambda body: body["skills"].append(dict(body["skills"][0])), "exactly once"),
        (lambda body: body["templates"][0].update(key="other"), "exactly once"),
        (lambda body: body.update(project=None), "exactly once"),
    ],
)
async def test_bad_decisions_create_nothing(api, change, message):
    client, sessions = api
    before = await counts(sessions)
    body = decisions()
    change(body)
    response = await post_import(client, body)
    assert response.status_code == 400
    assert message in response.json()["detail"]
    assert await counts(sessions) == before


async def test_unrequested_assignment_is_rejected(api):
    client, sessions = api
    data = manifest()
    data["skills"][0]["request_main_agent_assignment"] = False
    body = decisions(data)
    body["skills"][0]["assign_to_main_agent"] = True
    before = await counts(sessions)
    response = await post_import(client, body)
    assert response.status_code == 400
    assert "does not request" in response.json()["detail"]
    assert await counts(sessions) == before


async def test_policy_is_rechecked_at_import(api):
    client, sessions = api
    data = manifest()
    data["skills"][0]["request_main_agent_assignment"] = True
    tools = decisions(data)
    tools["sub_agents"][0]["approved_tools"] = ["web_search"]
    skills = decisions(data)
    skills["skills"][0]["assign_to_main_agent"] = True
    before = await counts(sessions)
    async with sessions() as session:
        await session.execute(
            update(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "active_tools").values(value=[])
        )
        await session.execute(
            update(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "skills_enabled").values(value=False)
        )
        await session.commit()
    assert "not available here" in (await post_import(client, tools)).json()["detail"]
    assert "turned off" in (await post_import(client, skills)).json()["detail"]
    assert await counts(sessions) == before


async def test_approved_tools_need_a_tool_model_but_declined_tools_do_not(api):
    client, _ = api
    body = decisions()
    body["sub_agents"][0] |= {"model_id": str(PLAIN_MODEL), "approved_tools": ["web_search"]}
    response = await post_import(client, body)
    assert response.status_code == 400
    assert "does not support tools" in response.json()["detail"]
    body["sub_agents"][0]["approved_tools"] = []
    assert (await post_import(client, body)).status_code == 200


async def test_conflicts_are_reported_then_resolved_by_rename_or_skip(api):
    client, sessions = api
    assert (await post_import(client, decisions())).status_code == 200
    review = (await client.post("/team-packs/review", headers=auth(), json={"source": source()})).json()
    assert review["sub_agents"][0]["name_conflict"] is True
    assert review["skills"][0]["name_conflict"] is True
    assert review["templates"][0]["name_conflict"] is True
    assert review["rubrics"][0]["name_conflict"] is True
    assert review["project"]["name_conflict"] is True

    before = await counts(sessions)
    conflict = await post_import(client, decisions())
    assert conflict.status_code == 409
    assert await counts(sessions) == before

    body = decisions()
    body["sub_agents"][0]["name"] = "Researcher two"
    body["skills"][0]["name"] = "cite-sources-two"
    body["templates"][0]["name"] = "Summary two"
    body["rubrics"][0]["include"] = False
    body["project"]["name"] = "Second project"
    response = await post_import(client, body)
    assert response.status_code == 200, response.text
    assert response.json()["rubric_ids"] == []
    async with sessions() as session:
        skill = await session.get(SkillModel, uuid.UUID(response.json()["skill_ids"][0]))
        template = await session.get(PromptTemplateModel, uuid.UUID(response.json()["template_ids"][0]))
    assert skill.name == "cite-sources-two"
    assert parse_document(skill.content).name == "cite-sources-two"
    assert json.loads(template.document)["name"] == "Summary two"


async def test_conflicts_fold_case_and_are_per_owner(api):
    client, _ = api
    assert (await post_import(client, decisions(), user="b")).status_code == 200
    review = (await client.post("/team-packs/review", headers=auth(), json={"source": source()})).json()
    assert review["sub_agents"][0]["name_conflict"] is False
    body = decisions()
    body["sub_agents"][0]["name"] = "Other"
    assert (await post_import(client, body)).status_code == 200
    data = manifest()
    data["sub_agents"][0]["name"] = "  OTHER "
    again = decisions(data)
    for section in ("skills", "templates", "rubrics"):
        again[section] = [{"key": item["key"], "include": False} for item in again[section]]
    again["project"] = {"include": False}
    assert (await post_import(client, again)).status_code == 409


async def test_renames_cannot_collide_within_a_pack(api):
    client, sessions = api
    data = manifest()
    second = dict(data["sub_agents"][0], key="second", name="Second")
    data["sub_agents"].append(second)
    body = decisions(data)
    body["sub_agents"][1]["name"] = "researcher"
    before = await counts(sessions)
    assert (await post_import(client, body)).status_code == 409
    assert await counts(sessions) == before


async def test_skipped_sub_agents_leave_the_project_selection(api):
    client, sessions = api
    body = decisions()
    body["sub_agents"][0] = {"key": body["sub_agents"][0]["key"], "include": False}
    response = await post_import(client, body)
    assert response.status_code == 200, response.text
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ProjectSubAgentModel)) == 0


async def test_importing_nothing_is_rejected(api):
    client, _ = api
    data = decisions()
    for section in ("sub_agents", "skills", "templates", "rubrics"):
        data[section] = [{"key": item["key"], "include": False} for item in data[section]]
    data["project"] = {"include": False}
    response = await post_import(client, data)
    assert response.status_code == 400
    assert "at least one" in response.json()["detail"]


@pytest.mark.parametrize("failing", ["_provenance", "add_assignments"])
async def test_failure_after_writing_rolls_everything_back(api, monkeypatch, failing):
    client, sessions = api

    def explode(*_args, **_kwargs):
        raise RuntimeError("late failure")

    monkeypatch.setattr(f"asterism.domains.packs.importer.{failing}", explode)
    data = manifest()
    data["skills"][0]["request_main_agent_assignment"] = True
    body = decisions(data)
    body["skills"][0]["assign_to_main_agent"] = True
    before = await counts(sessions)
    with pytest.raises(RuntimeError):
        await post_import(client, body)
    assert await counts(sessions) == before


async def test_integrity_failure_is_a_conflict_and_leaves_nothing(api, monkeypatch):
    """A name taken between the check and the write, as a concurrent import would."""
    client, sessions = api
    real = "asterism.domains.packs.importer.existing_names"
    from asterism.domains.packs import importer

    original = importer.existing_names

    async def stale(user_id, session):
        names = await original(user_id, session)
        return type(names)(**{**names.__dict__, "projects": frozenset(), "skills": frozenset()})

    assert (await post_import(client, decisions())).status_code == 200
    before = await counts(sessions)
    monkeypatch.setattr(real, stale)
    body = decisions()
    body["sub_agents"][0]["name"] = "New name"
    body["templates"][0]["name"] = "New template"
    body["rubrics"][0]["name"] = "New rubric"
    response = await post_import(client, body)
    assert response.status_code == 409
    assert await counts(sessions) == before


@pytest.mark.parametrize(
    "content",
    [
        SKILL,
        '---\n{"name": "cite-sources", "description": "yes: a #tricky one"}\n---\nBody\n---\nMore\n',
    ],
)
async def test_rename_keeps_description_and_instructions(content):
    renamed = rename_document(content, "new-name")
    assert parse_document(renamed).name == "new-name"
    assert parse_document(renamed).description == parse_document(content).description
    assert renamed.split("---\n", 2)[2] == content.split("---\n", 2)[2]


async def test_rename_to_an_invalid_skill_name_is_a_bad_request(api):
    client, _ = api
    body = decisions()
    body["skills"][0]["name"] = "Not A Slug"
    response = await post_import(client, body)
    assert response.status_code == 400
    assert response.json()["detail"].startswith("Pack item 'cite':")


async def test_exported_pack_imports_for_another_user(export_setup, monkeypatch):
    client, sessions = export_setup["client"], export_setup["sessions"]
    monkeypatch.setitem(tool_registry.registry, "web_search", object())
    async with sessions() as session:
        await session.execute(update(LLMModel).where(LLMModel.id == TOOL_MODEL).values(supports_tools=True))
        session.add(ApplicationSettingsModel(key="active_tools", value=["web_search"]))
        await session.commit()
    exported = await client.post(export_setup["url"], headers=auth(), json=everything(export_setup))
    assert exported.status_code == 200, exported.text
    pack = exported.json()
    review = await client.post("/team-packs/review", headers=auth("b"), json={"source": source(pack)})
    assert review.status_code == 200, review.text
    assert all(not agent["name_conflict"] for agent in review.json()["sub_agents"])
    body = decisions(pack)
    response = await post_import(client, body, user="b")
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(result["sub_agent_ids"]) == len(pack["sub_agents"])
    async with sessions() as session:
        project = await session.get(ProjectModel, uuid.UUID(result["project_id"]))
        rows = await session.scalars(select(AgentProfileModel).where(AgentProfileModel.user_id == "b"))
        assert project.user_id == "b"
        assert {row.name for row in rows if row.sub_agent} == {agent["name"] for agent in pack["sub_agents"]}
