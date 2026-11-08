"""US-70.2: a group's model and tool lists narrow what its members can use, checked live (ADR-0058)."""

import uuid

import pytest
from asterism.core.exceptions import CodedException
from asterism.domains.chat.model_selection import list_chat_models, require_chat_model
from asterism.domains.chatgpt.availability import GROUP_UNAVAILABLE, available_user_model
from asterism.domains.llm.selection import resolve_usable_model
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.service import get_draft_model
from asterism.domains.tools.builtin import load_builtin_tools
from asterism.domains.tools.registry import _group_allows_tool
from test_classes import api as _api
from test_courses import MODEL, OTHER_MODEL, apply, offer, publish, student_records
from test_courses import course as _course
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
api = _api
course = _course
project_api = _project_api

TOOLS = ["web_fetch", "web_search"]


async def restrict(client, group="student", models=None, tools=None):
    response = await client.put(
        f"/groups/{group}/access",
        headers=auth("admin"),
        json={"models": None if models is None else [str(m) for m in models], "tools": tools},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def enable_tools(sessions):
    load_builtin_tools()
    async with sessions() as session:
        session.add(ApplicationSettingsModel(key="active_tools", value=TOOLS))
        await session.commit()


def sub_agent(model=OTHER_MODEL, tools=()):
    return {"name": "Helper", "model_id": str(model), "system_prompt": "Help.", "tools": list(tools)}


async def test_admins_set_access_to_shared_models_and_configurable_tools_only(api):
    client, _ = api
    load_builtin_tools()
    group = await restrict(client, models=[MODEL, MODEL], tools=["web_fetch"])
    assert (group["models"], group["tools"]) == ([str(MODEL)], ["web_fetch"])
    reset = await restrict(client)
    assert (reset["models"], reset["tools"]) == (None, None)

    for body in (
        {"models": [str(uuid.uuid4())], "tools": None},
        {"models": None, "tools": ["no_such_tool"]},
        {"models": None, "tools": ["sub_agent"]},  # internal tools follow live context, not groups
    ):
        assert (await client.put("/groups/student/access", headers=auth("admin"), json=body)).status_code == 400
    assert (
        await client.put("/groups/student/access", headers=auth("teach"), json={"models": None, "tools": None})
    ).status_code == 401
    assert (
        await client.put("/groups/nope/access", headers=auth("admin"), json={"models": None, "tools": None})
    ).status_code == 404


async def test_pickers_list_only_allowed_models_and_every_model_check_refuses_the_rest(api):
    client, sessions = api
    await restrict(client, models=[MODEL])
    async with sessions() as session:
        assert [choice.id for choice in await list_chat_models("s1", session)] == [MODEL]
        # Chat sends, regenerates, compare targets and drafts all go through this check.
        with pytest.raises(CodedException, match=GROUP_UNAVAILABLE):
            await require_chat_model(OTHER_MODEL, "s1", session)
        # Delegation, course adds, pack imports and tool policy use this one.
        assert await available_user_model("s1", OTHER_MODEL, session) is None
        assert await available_user_model("s1", MODEL, session) is not None
        # Study tools and verification.
        with pytest.raises(CodedException, match=GROUP_UNAVAILABLE):
            await resolve_usable_model(user_id="s1", model_id=OTHER_MODEL, session=session)
        # Other groups are unaffected.
        assert len(await list_chat_models("teach", session)) == 2


async def test_existing_bindings_show_unavailable_and_new_ones_are_refused(api):
    client, _ = api
    created = await client.post("/agents/sub-agents", headers=auth("s1"), json=sub_agent())
    assert created.status_code == 201, created.text

    await restrict(client, models=[MODEL])
    [listed] = (await client.get("/agents/sub-agents", headers=auth("s1"))).json()["items"]
    assert listed["id"] == created.json()["id"] and listed["model_id"] == str(OTHER_MODEL)
    assert (listed["model_available"], listed["model_unavailable_reason"]) == (False, GROUP_UNAVAILABLE)
    refused = await client.post("/agents/sub-agents", headers=auth("s1"), json=sub_agent())
    assert refused.status_code == 400

    # Live: opening access again makes the same binding usable, with nothing retargeted.
    await restrict(client)
    [listed] = (await client.get("/agents/sub-agents", headers=auth("s1"))).json()["items"]
    assert listed["model_available"] is True and listed["model_id"] == str(OTHER_MODEL)


async def test_a_course_needing_a_model_the_group_cannot_use_is_not_added(course):
    await publish(course)
    await restrict(course["client"], models=[OTHER_MODEL])
    response = await apply(course, 1)
    assert response.status_code == 400 and "isn't available to you" in response.json()["detail"]
    assert (await student_records(course))[0] == []
    assert (await offer(course)).status_code == 200


async def test_tools_outside_the_group_are_hidden_refused_and_blocked_at_call_time(api):
    client, sessions = api
    await enable_tools(sessions)
    listed = await client.get("/tools/active", headers=auth("s1"))
    assert {item["name"] for item in listed.json()["items"]} == set(TOOLS)

    await restrict(client, tools=["web_fetch"])
    listed = await client.get("/tools/active", headers=auth("s1"))
    assert [item["name"] for item in listed.json()["items"]] == ["web_fetch"]
    teacher = await client.get("/tools/active", headers=auth("teach"))
    assert {item["name"] for item in teacher.json()["items"]} == set(TOOLS)

    refused = await client.post("/agents/sub-agents", headers=auth("s1"), json=sub_agent(tools=["web_search"]))
    assert refused.status_code == 400 and "web_search" in refused.json()["detail"]
    allowed = await client.post("/agents/sub-agents", headers=auth("s1"), json=sub_agent(tools=["web_fetch"]))
    assert allowed.status_code == 201, allowed.text

    # The call-time gate reads the group live, so a model can't call a tool its turn wasn't given.
    assert await _group_allows_tool("s1", "web_fetch") is True
    assert await _group_allows_tool("s1", "web_search") is False
    await restrict(client, tools=[])
    assert await _group_allows_tool("s1", "web_fetch") is False


async def test_background_models_chosen_by_the_administrator_ignore_groups(api):
    client, sessions = api
    async with sessions() as session:
        session.add(ApplicationSettingsModel(key="draft_model_id", value=str(OTHER_MODEL)))
        await session.commit()
    await restrict(client, models=[MODEL])
    async with sessions() as session:
        assert (await get_draft_model(session)).id == OTHER_MODEL
