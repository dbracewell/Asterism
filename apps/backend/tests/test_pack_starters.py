"""US-59.4: bundled starter packs install through the normal review and import."""

import json
from pathlib import Path

import pytest
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.packs import starters
from asterism.domains.packs.documents import parse_pack
from asterism.domains.packs.models import PackImportModel
from asterism.domains.packs.starters import STARTER_PACK_IDS, STARTER_PACKS
from asterism.domains.projects.models import ProjectSubAgentModel
from asterism.domains.tools.builtin import load_builtin_tools
from asterism.domains.tools.catalog import INTERNAL_TOOL_NAMES
from asterism.domains.tools.registry import tool_registry
from sqlalchemy import func, select
from test_pack_import import TOOL_MODEL, api, decisions, post_import, source
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
pytestmark = pytest.mark.asyncio
pack_api = api
ALL = [item.id for item in STARTER_PACKS.items]


def starter(pack_id):
    return json.loads(next(item.source for item in STARTER_PACKS.items if item.id == pack_id))


async def test_catalog_matches_the_files_on_disk():
    directory = Path(starters.__file__).parent / "bundled"
    assert {path.name.removesuffix(".team-pack.json") for path in directory.glob("*.json")} == set(STARTER_PACK_IDS)


async def test_the_promised_starters_ship():
    assert [item.name for item in STARTER_PACKS.items] == [
        "Research, Critique, Synthesis",
        "Write, Review, Fact-check",
        "Study Buddy",
    ]


@pytest.mark.parametrize("pack_id", ALL)
async def test_starter_is_valid_and_consistent(pack_id):
    item = next(item for item in STARTER_PACKS.items if item.id == pack_id)
    manifest = parse_pack(item.source.encode("utf-8"))
    assert manifest.pack.id == pack_id
    assert manifest.pack.description
    assert manifest.project is not None
    assert set(manifest.project.sub_agents) == {agent.key for agent in manifest.sub_agents}
    prompt = manifest.project.system_prompt
    assert all(agent.name in prompt for agent in manifest.sub_agents), "the project must route to each sub-agent"


@pytest.mark.parametrize("pack_id", ALL)
async def test_requested_tools_exist_and_are_ordinary(pack_id):
    load_builtin_tools()
    requested = {tool for agent in starter(pack_id)["sub_agents"] for tool in agent["requested_tools"]}
    assert requested <= set(tool_registry.registry)
    assert not requested & INTERNAL_TOOL_NAMES


async def test_study_buddy_has_its_three_parts():
    pack = starter("study-buddy")
    assert {agent["name"] for agent in pack["sub_agents"]} == {"Tutor", "Flashcard Maker", "Feedback Coach"}
    assert pack["rubrics"]


async def test_catalog_needs_authentication(pack_api):
    client, _ = pack_api
    assert (await client.get("/team-packs/starters")).status_code == 401


@pytest.mark.parametrize("pack_id", ALL)
async def test_starter_installs_through_review_and_import(pack_api, pack_id):
    client, sessions = pack_api
    listed = await client.get("/team-packs/starters", headers=auth())
    assert listed.status_code == 200
    pack = json.loads(next(item["source"] for item in listed.json()["items"] if item["id"] == pack_id))
    review = await client.post("/team-packs/review", headers=auth(), json={"source": source(pack)})
    assert review.status_code == 200, review.text

    response = await post_import(client, decisions(pack))
    assert response.status_code == 200, response.text
    result = response.json()
    async with sessions() as session:
        agents = list(await session.scalars(select(AgentProfileModel).where(AgentProfileModel.sub_agent.is_(True))))
        selected = await session.scalar(select(func.count()).select_from(ProjectSubAgentModel))
        record = await session.scalar(select(PackImportModel))
    assert {agent.name for agent in agents} == {agent["name"] for agent in pack["sub_agents"]}
    assert all(agent.model_id == TOOL_MODEL and agent.tools == [] for agent in agents)
    assert selected == len(pack["sub_agents"])
    assert record.pack_id == pack_id
    assert result["project_id"]


@pytest.mark.parametrize("pack_id", ALL)
async def test_installing_twice_needs_the_conflicts_resolved(pack_api, pack_id):
    client, _ = pack_api
    pack = starter(pack_id)
    assert (await post_import(client, decisions(pack))).status_code == 200
    assert (await post_import(client, decisions(pack))).status_code == 409
