"""US-75.3: sub-agents load their own assigned skills with load_skill (ADR-0062)."""

import json
import uuid
from contextlib import asynccontextmanager
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from asterism.core.exceptions import BadDataException, ForbiddenException, NotFoundException
from asterism.domains.agent.capabilities import CapabilityGrant, CapabilityKind
from asterism.domains.agent.prompts import PromptComposer
from asterism.domains.agent.schemas import AgentEvent, AgentEventType, SubAgentEventEnvelope
from asterism.domains.agent.service import get_agent_profile
from asterism.domains.chat.capabilities import build_capability_manifest
from asterism.domains.chat.delegations import DelegationCollector
from asterism.domains.chat.prompt_composition import read_skill_catalog_layer
from asterism.domains.chat.tool_policy import require_internal_tool, resolve_effective_tools
from asterism.domains.llm.schemas import Function, ToolCall, ToolResult
from asterism.domains.packs.documents import parse_pack
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel
from asterism.domains.skills.models import AgentSkillModel
from asterism.domains.tools.builtin.load_skill import LoadSkillArgs, load_skill
from asterism.domains.tools.catalog import SKILL_TOOL_NAME, ToolPolicy, configurable_tools
from asterism.domains.tools.registry import ToolContext, tool_registry
from sqlalchemy import select, update
from test_context_tools import context_runtime, resolve
from test_pack_documents import SKILL, manifest
from test_pack_export import everything
from test_pack_export import setup as _export_setup
from test_pack_import import api as _import_api
from test_pack_import import decisions, post_import, source
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
runtime = context_runtime
export_setup = _export_setup
import_api = _import_api


def document(name, description="Review code carefully.", body="# Review\nCheck edge cases."):
    return f"---\nname: {name}\ndescription: {description}\n---\n{body}\n"


async def create_skill(client, name, user="a", **kwargs):
    response = await client.post("/skills/", headers=auth(user), json={"content": document(name, **kwargs)})
    assert response.status_code == 201, response.text
    return response.json()


def skills_url(agent_id):
    return f"/agents/sub-agents/{agent_id}/skills"


async def assign(client, agent_id, skill_ids, user="a"):
    current = (await client.get(skills_url(agent_id), headers=auth(user))).json()
    response = await client.put(
        skills_url(agent_id),
        headers=auth(user),
        json={"skill_ids": skill_ids, "expected_revision": current["revision"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def set_policy(sessions, enabled):
    async with sessions() as db:
        row = await db.get(ApplicationSettingsModel, "skills_enabled")
        if row is None:
            db.add(ApplicationSettingsModel(key="skills_enabled", value=enabled))
        else:
            row.value = enabled
        await db.commit()


@pytest.fixture
def skills_runtime(runtime, monkeypatch):
    @asynccontextmanager
    async def session_context(session=None):
        if session is not None:
            yield session
        else:
            async with runtime.sessions() as db:
                yield db

    # load_skill opens its own session for every live check.
    monkeypatch.setattr("asterism.db.database.get_async_db_session", session_context)
    return runtime


async def child_tools(r):
    """The child's tools and scope when the main agent delegates to sub-agent ``a``."""
    _, scope = await resolve(r)
    child = await get_agent_profile("a", uuid.UUID(r.a["id"]))
    child_scope = replace(scope, caller_agent_id=child.id, model_id=child.model_id)
    names, ceiling = await resolve_effective_tools(
        user_id="a", chat_id=r.chat_id, profile=child, model_id=child.model_id, ceiling=child_scope
    )
    return child, names, ceiling


def load_ctx(r, scope, name):
    return ToolContext(
        args=LoadSkillArgs(name=name),
        user=r.user,
        user_message="",
        session=r.chat,
        app_settings=MagicMock(),
        client=MagicMock(),
        tool_scope=scope,
    )


async def test_sub_agent_assignments_are_owned_revision_guarded_and_separate_from_the_main_agent(skills_runtime):
    r = skills_runtime
    client = r.client
    mine = await create_skill(client, "review-code")
    theirs = await create_skill(client, "review-code", user="b")
    url = skills_url(r.a["id"])
    start = (await client.get(url, headers=auth())).json()
    assert start["skill_ids"] == []

    def put(ids, revision=start["revision"], user="a", target=url):
        return client.put(target, headers=auth(user), json={"skill_ids": ids, "expected_revision": revision})

    assert (await put([theirs["id"]])).status_code == 404
    assert (await put([str(uuid.uuid4())])).status_code == 404
    assert (await put([mine["id"], mine["id"]])).status_code == 400
    assert (await put([str(uuid.uuid4()) for _ in range(101)])).status_code == 422
    saved = await put([mine["id"]])
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"skill_ids": [mine["id"]], "revision": start["revision"] + 1}
    assert (await put([], revision=start["revision"])).status_code == 409
    # Another user's sub-agent and the main agent are not reachable here.
    main = (await client.get("/settings/user/main-agent", headers=auth())).json()
    assert (await client.get(skills_url(main["id"]), headers=auth())).status_code == 404
    assert (await client.get(url, headers=auth("b"))).status_code == 404
    assert (await put([theirs["id"]], user="b")).status_code == 404

    # A sub-agent assignment never makes a skill eligible for `/` in chats.
    await set_policy(r.sessions, True)
    assert (await client.get("/settings/user/main-agent/skills", headers=auth())).json()["skill_ids"] == []
    assert (await client.get("/skills/eligible", headers=auth())).json()["items"] == []

    # Deleting the skill removes the assignment.
    deleted = await client.delete(f"/skills/{mine['id']}?expected_revision=1", headers=auth())
    assert deleted.status_code == 204, deleted.text
    assert (await client.get(url, headers=auth())).json()["skill_ids"] == []


async def test_load_skill_is_offered_only_to_sub_agents_with_skills_policy_and_tool_models(skills_runtime):
    r = skills_runtime
    skill = await create_skill(r.client, "review-code")
    await assign(r.client, r.a["id"], [skill["id"]])

    # Policy off: no tool, no catalog.
    _, names, _ = await child_tools(r)
    assert SKILL_TOOL_NAME not in names
    await set_policy(r.sessions, True)
    child, names, ceiling = await child_tools(r)
    assert SKILL_TOOL_NAME in names
    # The main agent keeps `/` and never gets load_skill (ADR-0062).
    assert SKILL_TOOL_NAME not in (await resolve(r))[0]
    # It needs no Tools allowlist entry; the Skills policy is its admin gate.
    async with r.sessions() as db:
        assert SKILL_TOOL_NAME not in (await db.get(ApplicationSettingsModel, "active_tools")).value
    await require_internal_tool(name=SKILL_TOOL_NAME, user_id="a", chat_id=r.chat_id, scope=ceiling)

    # A model without tool support gets nothing.
    async with r.sessions() as db:
        await db.execute(update(LLMModel).where(LLMModel.id == child.model_id).values(supports_tools=False))
        await db.commit()
    assert SKILL_TOOL_NAME not in (await child_tools(r))[1]
    async with r.sessions() as db:
        await db.execute(update(LLMModel).where(LLMModel.id == child.model_id).values(supports_tools=True))
        await db.commit()

    # No assigned skills, no tool.
    await assign(r.client, r.a["id"], [])
    assert SKILL_TOOL_NAME not in (await child_tools(r))[1]


async def test_catalog_lists_names_and_descriptions_but_not_bodies(skills_runtime):
    r = skills_runtime
    await set_policy(r.sessions, True)
    first = await create_skill(r.client, "write-tests", description="Write focused tests.", body="SECRET BODY")
    second = await create_skill(r.client, "review-code")
    await create_skill(r.client, "unassigned")
    await assign(r.client, r.a["id"], [first["id"], second["id"]])
    child, names, _ = await child_tools(r)
    entries, layer = await read_skill_catalog_layer(user_id="a", profile=child, tools=names)
    assert [entry.name for entry in entries] == ["review-code", "write-tests"]
    assert layer is not None and layer.kind == "skill_catalog"
    assert "- write-tests: Write focused tests." in layer.text
    assert "SECRET BODY" not in layer.text and "unassigned" not in layer.text
    text = (
        PromptComposer()
        .snapshot(
            agent_id=child.id,
            agent_revision=1,
            agent_instructions="Work.",
            skill_catalog_layer=layer,
            runtime_context="tools",
        )
        .text
    )
    assert text.index("[skill_catalog instructions]") < text.index("[runtime instructions]")
    assert "load_skill from your skill catalog has the same standing as an activated skill" in text
    # Without the tool there is no catalog, even with assignments.
    assert await read_skill_catalog_layer(user_id="a", profile=child, tools=[]) == ((), None)

    # The child's capability manifest lists its catalog as its own assignments.
    async with r.sessions() as db:
        manifest = await build_capability_manifest(
            user_id="a",
            chat_id=r.chat_id,
            profile=child,
            model_supports_tools=True,
            tools=names,
            auto_approved_tools=None,
            skills=(),
            files=(),
            delegation=None,
            session=db,
            catalog_skills=entries,
        )
    skills = [entry for entry in manifest.entries if entry.kind == CapabilityKind.SKILL]
    assert [entry.name for entry in skills] == ["review-code", "write-tests"]
    assert skills[0].grants == [CapabilityGrant.AGENT_ASSIGNMENT, CapabilityGrant.ADMIN_POLICY]


async def test_load_skill_rechecks_policy_and_assignment_on_every_call(skills_runtime):
    r = skills_runtime
    await set_policy(r.sessions, True)
    skill = await create_skill(r.client, "review-code", body="# Review\nCheck edge cases.")
    other = await create_skill(r.client, "other")
    await create_skill(r.client, "theirs", user="b")
    await assign(r.client, r.a["id"], [skill["id"]])
    _, _, scope = await child_tools(r)

    loaded = await load_skill(load_ctx(r, scope, "review-code"))
    assert loaded == {
        "skill_id": skill["id"],
        "name": "review-code",
        "revision": 1,
        "instructions": document("review-code"),
    }
    for name in ["other", "theirs", "missing"]:
        with pytest.raises(NotFoundException):
            await load_skill(load_ctx(r, scope, name))
    # The calling agent comes from the server scope, not model input.
    main_scope = replace(scope, caller_agent_id=r.profile.id, model_id=uuid.UUID(int=2))
    with pytest.raises(NotFoundException):
        await load_skill(load_ctx(r, main_scope, "review-code"))
    with pytest.raises(BadDataException):
        await require_internal_tool(name=SKILL_TOOL_NAME, user_id="a", chat_id=r.chat_id, scope=main_scope)
    with pytest.raises(BadDataException):
        await load_skill(load_ctx(r, None, "review-code"))

    # An edit is seen by the next load.
    edited = await r.client.put(
        f"/skills/{skill['id']}",
        headers=auth(),
        json={"content": document("review-code", body="# Review\nNew step."), "expected_revision": 1},
    )
    assert edited.status_code == 200, edited.text
    assert (await load_skill(load_ctx(r, scope, "review-code")))["revision"] == 2

    # Turning skills off stops loads mid-run, at both gates.
    await set_policy(r.sessions, False)
    with pytest.raises(ForbiddenException):
        await load_skill(load_ctx(r, scope, "review-code"))
    with pytest.raises(BadDataException):
        await require_internal_tool(name=SKILL_TOOL_NAME, user_id="a", chat_id=r.chat_id, scope=scope)
    await set_policy(r.sessions, True)

    # Unassigning it mid-run makes the next load fail.
    await assign(r.client, r.a["id"], [other["id"]])
    with pytest.raises(NotFoundException):
        await load_skill(load_ctx(r, scope, "review-code"))


async def test_invoking_load_skill_needs_the_skills_policy_not_the_tools_allowlist(skills_runtime):
    r = skills_runtime
    await set_policy(r.sessions, True)
    skill = await create_skill(r.client, "review-code")
    await assign(r.client, r.a["id"], [skill["id"]])
    _, _, scope = await child_tools(r)

    async def authorize(name):
        await require_internal_tool(name=name, user_id="a", chat_id=r.chat_id, scope=scope)

    async def call(arguments='{"name": "review-code"}'):
        result = await tool_registry.invoke_tool(
            tool_call=ToolCall(id="c1", function=Function(name=SKILL_TOOL_NAME, arguments=arguments)),
            user=r.user,
            client=MagicMock(),
            session=r.chat,
            app_settings=SimpleNamespace(active_tools=[]),
            max_retries=0,
            tool_scope=scope,
            authorize_internal=authorize,
        )
        return json.loads(result.content)

    assert (await call())["name"] == "review-code"
    assert "error" in await call('{"name": "missing"}')
    # Without the server's authorization callback the tool never runs.
    unauthorized = await tool_registry.invoke_tool(
        tool_call=ToolCall(id="c2", function=Function(name=SKILL_TOOL_NAME, arguments='{"name": "review-code"}')),
        user=r.user,
        client=MagicMock(),
        session=r.chat,
        app_settings=SimpleNamespace(active_tools=[SKILL_TOOL_NAME]),
        tool_scope=scope,
    )
    assert "error" in json.loads(unauthorized.content)
    await set_policy(r.sessions, False)
    assert "Skills are unavailable" in (await call())["error"]


async def test_load_skill_cannot_be_assigned_listed_or_granted_like_a_tool(skills_runtime):
    r = skills_runtime
    assert tool_registry[SKILL_TOOL_NAME].policy == ToolPolicy.CONTEXT_MANAGED
    assert SKILL_TOOL_NAME not in {tool.name for tool in tool_registry.tools().items}
    assert configurable_tools([SKILL_TOOL_NAME, "web_search"]) == ["web_search"]
    assert (
        await r.client.put("/settings/user/main-agent", headers=auth(), json={"tools": [SKILL_TOOL_NAME]})
    ).status_code == 400
    assert (
        await r.client.post(
            "/agents/sub-agents",
            headers=auth(),
            json={"name": "Forged", "model_id": str(uuid.UUID(int=1)), "tools": [SKILL_TOOL_NAME]},
        )
    ).status_code == 400


def load_result(call_id, content, name=SKILL_TOOL_NAME):
    call = ToolCall(id=call_id, function=Function(name=name, arguments="{}"))
    return ToolResult(content=content, raw_result=None, is_empty=False, tool_call=call)


async def test_skill_loads_are_recorded_on_the_delegation_record():
    collector = DelegationCollector()
    skill_id = uuid.uuid4()
    loaded = json.dumps({"skill_id": str(skill_id), "name": "review-code", "revision": 3, "instructions": "x"})

    def step(results):
        return SubAgentEventEnvelope(
            execution_id=uuid.UUID(int=9),
            sub_agent_id=uuid.UUID(int=8),
            sub_agent_name="Worker",
            depth=1,
            event=AgentEvent(type=AgentEventType.COMPLETE, tool_results=results),
        )

    collector.observe(
        step(
            [
                load_result("1", loaded),
                load_result("2", json.dumps({"error": "Tool failed with exception: not assigned"})),
                load_result("3", json.dumps({"skill_id": str(skill_id)}), name="web_search"),
            ]
        )
    )
    collector.observe(step([load_result("4", loaded)]))
    [record] = collector.drain()
    assert [(load.skill_id, load.name, load.revision) for load in record.skill_loads] == [
        (skill_id, "review-code", 3),
        (skill_id, "review-code", 3),
    ]
    assert record.sub_agent_id == uuid.UUID(int=8)


async def test_pack_export_requests_assigned_skills_that_the_pack_carries(export_setup):
    s = export_setup
    async with s["sessions"]() as db:
        db.add_all(
            [
                AgentSkillModel(
                    agent_id=uuid.UUID(s["researcher"]),
                    user_id="a",
                    skill_id=uuid.UUID(s["other_skill"]),
                    sub_agent=True,
                ),
                AgentSkillModel(
                    agent_id=uuid.UUID(s["critic"]), user_id="a", skill_id=uuid.UUID(s["skill"]), sub_agent=True
                ),
            ]
        )
        await db.commit()
    response = await s["client"].post(s["url"], headers=auth(), json=everything(s))
    assert response.status_code == 200, response.text
    pack = parse_pack(response.content)
    critic, researcher = pack.sub_agents
    # Skills are keyed by name: cite-sources is skill-1, other is skill-2.
    assert researcher.requested_skills == ("skill-2",)
    assert critic.requested_skills == ("skill-1",)
    assert critic.model_requirements.tools
    # A sub-agent assignment is not a main-agent assignment request.
    assert [skill.request_main_agent_assignment for skill in pack.skills] == [True, False]

    body = everything(s) | {"skill_ids": [s["skill"]]}
    researcher = parse_pack((await s["client"].post(s["url"], headers=auth(), json=body)).content).sub_agents[1]
    assert researcher.requested_skills == ()


def requesting_pack():
    data = manifest()
    data["sub_agents"][0]["requested_skills"] = ["cite"]
    return data


async def test_pack_import_assigns_only_approved_imported_skills(import_api):
    client, sessions = import_api
    review = await client.post("/team-packs/review", headers=auth(), json={"source": source(requesting_pack())})
    assert review.status_code == 200, review.text
    assert review.json()["sub_agents"][0]["requested_skills"] == ["cite"]

    declined = await post_import(client, decisions(requesting_pack()))
    assert declined.status_code == 200, declined.text
    async with sessions() as db:
        assert list(await db.scalars(select(AgentSkillModel).where(AgentSkillModel.sub_agent.is_(True)))) == []

    body = decisions(requesting_pack())
    body["sub_agents"][0].update(name="Researcher 2", approved_skills=["cite"])
    body["skills"][0]["name"] = "cite-sources-2"
    body["templates"][0]["include"] = False
    body["rubrics"][0]["include"] = False
    body["project"] = {"include": False}
    approved = await post_import(client, body)
    assert approved.status_code == 200, approved.text
    result = approved.json()
    async with sessions() as db:
        [row] = await db.scalars(select(AgentSkillModel).where(AgentSkillModel.sub_agent.is_(True)))
    assert (str(row.agent_id), str(row.skill_id)) == (result["sub_agent_ids"][0], result["skill_ids"][0])


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda body: body["sub_agents"][0].update(approved_skills=["other"]), "pack requests"),
        (lambda body: body["sub_agents"][0].update(approved_skills=["cite", "cite"]), "pack requests"),
        (
            lambda body: (
                body["sub_agents"][0].update(approved_skills=["cite"]),
                body["skills"][0].update(include=False),
            ),
            "import every skill",
        ),
        (
            lambda body: body["sub_agents"][0].update(approved_skills=["cite"], model_id=str(uuid.UUID(int=2))),
            "does not support tools",
        ),
    ],
)
async def test_bad_skill_approvals_create_nothing(import_api, change, message):
    client, _ = import_api
    body = decisions(requesting_pack())
    change(body)
    response = await post_import(client, body)
    assert response.status_code == 400
    assert message in response.json()["detail"]


async def test_pack_skill_approvals_need_the_skills_policy(import_api):
    client, sessions = import_api
    await set_policy(sessions, False)
    body = decisions(requesting_pack())
    body["sub_agents"][0]["approved_skills"] = ["cite"]
    response = await post_import(client, body)
    assert response.status_code == 400
    assert "turned off" in response.json()["detail"]


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (lambda agent: agent.update(requested_skills=["missing"]), "does not define"),
        (lambda agent: agent.update(requested_skills=["cite", "cite"]), "must be unique"),
        (
            lambda agent: agent.update(requested_skills=["cite"], requested_tools=[], model_requirements={}),
            "must include tools",
        ),
    ],
)
async def test_pack_skill_requests_are_validated(edit, message):
    data = manifest()
    edit(data["sub_agents"][0])
    with pytest.raises(BadDataException) as error:
        parse_pack(json.dumps(data).encode())
    assert message in str(error.value)


async def test_the_requesting_pack_is_valid():
    assert parse_pack(json.dumps(requesting_pack()).encode()).sub_agents[0].requested_skills == ("cite",)
    assert SKILL in requesting_pack()["skills"][0]["content"]


async def test_a_delegated_sub_agent_sees_its_catalog_loads_a_skill_and_the_load_is_recorded(
    skills_runtime, monkeypatch
):
    from unittest.mock import AsyncMock

    from asterism.domains.agent.agent import Agent
    from asterism.domains.llm.schemas import LLMEvent, LLMEventType
    from asterism.domains.tools.builtin.sub_agent import SubAgentArgs, sub_agent
    from test_context_tools import make_execution_scope

    r = skills_runtime
    await set_policy(r.sessions, True)
    skill = await create_skill(r.client, "review-code", body="# Review\nCheck edge cases.")
    await assign(r.client, r.a["id"], [skill["id"]])
    _, scope = await resolve(r)
    calls: list[dict] = []

    class Client:
        async def chat(self, messages, tools, **kwargs):
            calls.append({"system": messages[0].content, "tools": list(tools or []), "messages": list(messages)})
            if len(calls) == 1:
                yield LLMEvent(
                    type=LLMEventType.COMPLETE,
                    tool_calls=[
                        ToolCall(id="load", function=Function(name=SKILL_TOOL_NAME, arguments='{"name":"review-code"}'))
                    ],
                    finish_reason="tool_calls",
                )
            else:
                yield LLMEvent(type=LLMEventType.COMPLETE, content="Reviewed.", finish_reason="stop")

    monkeypatch.setattr(Agent, "_get_client", AsyncMock(return_value=Client()))
    collector = DelegationCollector()
    result = await sub_agent(
        ToolContext(
            args=SubAgentArgs(agent_id=uuid.UUID(r.a["id"]), prompt="Review this diff"),
            user=r.user,
            user_message="",
            session=r.chat,
            client=MagicMock(),
            app_settings=MagicMock(),
            tool_scope=scope,
            delegation_scope=scope.delegation,
            execution_scope=make_execution_scope(r, scope),
            event_sink=collector.observe,
        )
    )
    assert result == "Reviewed."
    first, second = calls
    assert "[skill_catalog instructions]" in first["system"]
    assert "- review-code: Review code carefully." in first["system"]
    assert "Check edge cases." not in first["system"]
    assert SKILL_TOOL_NAME in first["tools"]
    # The loaded body reaches the child as the tool result.
    assert any("Check edge cases." in str(message.content) for message in second["messages"])
    [record] = collector.drain()
    assert [(str(load.skill_id), load.name, load.revision) for load in record.skill_loads] == [
        (skill["id"], "review-code", 1)
    ]
    assert record.capabilities is not None
    assert [entry.name for entry in record.capabilities.entries if entry.kind == CapabilityKind.SKILL] == [
        "review-code"
    ]
