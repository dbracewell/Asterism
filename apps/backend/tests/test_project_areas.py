"""Feature areas (US-65.2) are display only: they keep data and change no capability."""

import json
import uuid

import pytest
from asterism.domains.chat.delegation import resolve_delegation_scope
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel
from asterism.domains.projects.models import ProjectFileModel
from test_project_sub_agents import runtime_setup
from test_projects_api import auth, create
from test_projects_api import project_api as _project_api

project_api = _project_api

ALL_ON = {"study": True, "reflections": True, "goal": True, "sub_agents": True}
ALL_OFF = dict.fromkeys(ALL_ON, False)


async def patch(client, project, **fields):
    path = f"/projects/{project['id']}"
    revision = (await client.get(path, headers=auth())).json()["context_revision"]
    return await client.patch(path, headers=auth(), json={"expected_context_revision": revision, **fields})


async def effective_tools(chat_id):
    from asterism.domains.agent.service import get_main_agent_profile
    from asterism.domains.chat.tool_policy import resolve_effective_tools

    profile = await get_main_agent_profile("a")
    return await resolve_effective_tools(user_id="a", chat_id=chat_id, profile=profile, model_id=uuid.UUID(int=2))


@pytest.mark.asyncio
async def test_areas_default_on_and_update_as_metadata(project_api):
    client, _, _ = project_api
    project = await create(client)
    assert project["areas"] == ALL_ON
    chosen = await create(client, "Chosen", areas=ALL_ON | {"study": False})
    assert chosen["areas"]["study"] is False

    response = await patch(client, project, areas=ALL_ON | {"reflections": False, "goal": False})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["areas"] == ALL_ON | {"reflections": False, "goal": False}
    # Display only: the execution-context revision does not move.
    assert body["context_revision"] == project["context_revision"]
    read = await client.get(f"/projects/{project['id']}", headers=auth())
    assert read.json()["areas"] == body["areas"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "areas",
    [None, {"study": False}, ALL_ON | {"files": False}, ALL_ON | {"study": "no"}],
)
async def test_areas_reject_null_partial_unknown_and_loose_values(project_api, areas):
    client, _, _ = project_api
    project = await create(client)
    assert (await patch(client, project, areas=areas)).status_code == 422
    assert (await client.post("/projects/", headers=auth(), json={"name": "X", "areas": areas})).status_code == 422


@pytest.mark.asyncio
async def test_hidden_areas_keep_their_data(project_api, monkeypatch):
    client, _, p, _, a, _, _ = await runtime_setup(project_api, monkeypatch)
    goal = await patch(client, p, goal="Pass the exam", goal_target_date="2027-01-31")
    assert goal.status_code == 200, goal.text

    hidden = (await patch(client, p, areas=ALL_OFF)).json()
    assert (hidden["goal"], hidden["goal_target_date"]) == ("Pass the exam", "2027-01-31")
    selected = await client.get(f"/projects/{p['id']}/sub-agents", headers=auth())
    assert [agent["id"] for agent in selected.json()["agents"]] == [a["id"]]

    shown = (await patch(client, p, areas=ALL_ON)).json()
    assert shown["goal"] == "Pass the exam"


@pytest.mark.asyncio
async def test_hiding_every_area_changes_no_capability(project_api, monkeypatch):
    client, sessions, p, _, _, _, chat_id = await runtime_setup(project_api, monkeypatch)
    async with sessions() as db:
        file = UserFileModel(
            storage_key=str(uuid.uuid4()),
            user_id="a",
            filename="notes.txt",
            original_name="notes.txt",
            size=1,
            mime_type="text/plain",
            kind=FileKind.TEXT,
            sha256="a" * 64,
        )
        db.add(file)
        await db.flush()
        db.add(ProjectFileModel(project_id=uuid.UUID(p["id"]), file_id=file.id, user_id="a"))
        db.add(FileKnowledgeArtifactModel(user_id="a", file_id=file.id, generation=1, processing_profile_generation=1))
        await db.commit()

    async def capabilities():
        file_scope = await client.get(f"/chat/{chat_id}/files/context", headers=auth())
        assert file_scope.status_code == 200, file_scope.text
        return (
            await resolve_delegation_scope(user_id="a", chat_id=chat_id),
            await effective_tools(chat_id),
            file_scope.json(),
        )

    before = await capabilities()
    delegation, (tools, ceiling), files = before
    assert delegation is not None and delegation.agent_ids
    assert ceiling is not None and ceiling.file_ids and ceiling.delegation
    assert {"sub_agent", "search_knowledge"} <= set(tools)
    assert files["allowed_file_ids"]

    assert (await patch(client, p, areas=ALL_OFF)).status_code == 200
    assert await capabilities() == before


@pytest.mark.asyncio
async def test_team_packs_carry_areas_and_older_packs_default_to_all_on(project_api):
    client, _, _ = project_api
    project = await create(client, "Source", areas=ALL_ON | {"study": False, "sub_agents": False})
    exported = await client.post(
        f"/projects/{project['id']}/pack-export",
        headers=auth(),
        json={"name": "Areas", "include_project_settings": True},
    )
    assert exported.status_code == 200, exported.text
    pack = json.loads(exported.content)
    assert pack["project"]["areas"] == ALL_ON | {"study": False, "sub_agents": False}

    async def import_as(user, data):
        body = {"source": json.dumps(data), "project": {"include": True, "name": f"Imported {user}"}}
        response = await client.post("/team-packs/import", headers=auth(user), json=body)
        assert response.status_code == 200, response.text
        imported = await client.get(f"/projects/{response.json()['project_id']}", headers=auth(user))
        return imported.json()["areas"]

    assert await import_as("b", pack) == pack["project"]["areas"]
    del pack["project"]["areas"]
    assert await import_as("a", pack) == ALL_ON
