import asyncio
import uuid
from dataclasses import replace

import pytest
from asterism.core.exceptions import BadDataException
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.chat.delegation import require_delegation_target, resolve_delegation_scope
from asterism.domains.chat.models import ChatModel
from asterism.domains.chat.schemas import Chat, ChatInfo
from asterism.domains.projects.models import ProjectModel, ProjectSubAgentModel
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel
from asterism.domains.tools.builtin.sub_agent import SubAgentArgs, sub_agent
from asterism.domains.tools.registry import ToolContext
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from test_projects_api import auth, create
from test_projects_api import project_api as _project_api

project_api = _project_api


async def worker(client, name="Worker", user="a"):
    response = await client.post(
        "/agents/sub-agents",
        headers=auth(user),
        json={
            "name": name,
            "description": name,
            "model_id": str(uuid.UUID(int=1)),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def change(client, project, ids, revision=1, method="POST", user="a"):
    return await client.request(
        method,
        f"/projects/{project['id']}/sub-agents",
        headers=auth(user),
        json={
            "agent_ids": ids,
            "expected_context_revision": revision,
        },
    )


@pytest.mark.asyncio
async def test_selection_atomicity_revision_listing_and_cleanup(project_api):
    client, sessions, _ = project_api
    p, q = await create(client), await create(client, "Other")
    a, b, foreign = await worker(client, "Z"), await worker(client, "A"), await worker(client, user="b")
    main = (await client.get("/settings/user/main-agent", headers=auth())).json()
    path = f"/projects/{p['id']}/sub-agents"
    assert (await client.get(path, headers=auth())).json()["agents"] == []
    for invalid in [foreign["id"], main["id"], str(uuid.uuid4())]:
        assert (await change(client, p, [a["id"], invalid])).status_code == 404
        assert (await client.get(path, headers=auth())).json()["context_revision"] == 1
        assert (await client.get(path, headers=auth())).json()["total"] == 0
    assert (await change(client, p, [a["id"]], user="b")).status_code == 404
    assert (await change(client, p, [a["id"], b["id"], a["id"]])).json()["changed_agent_ids"] == sorted(
        [a["id"], b["id"]]
    )
    assert (await change(client, p, [a["id"]], revision=2)).json()["context_revision"] == 2
    assert (await change(client, p, [a["id"]])).status_code == 409
    page = (await client.get(path, headers=auth(), params={"page_size": 1})).json()
    assert page["total"] == 2 and page["agents"][0]["id"] == b["id"]
    assert page["agents"][0]["model_available"]
    assert (await client.get(path, headers=auth(), params={"page": 3, "page_size": 1})).json()["agents"] == []
    assert (await client.get(f"/projects/{q['id']}/sub-agents", headers=auth())).json()["total"] == 0
    for method in ["POST", "DELETE"]:
        assert (await change(client, p, [a["id"], foreign["id"]], revision=2, method=method)).status_code == 404
    assert (await change(client, q, [a["id"]])).status_code == 200
    assert (await change(client, p, [b["id"]], revision=2, method="DELETE")).json()["context_revision"] == 3
    assert (await change(client, p, [b["id"]], revision=3, method="DELETE")).json()["context_revision"] == 3
    assert (await client.delete(f"/agents/sub-agents/{a['id']}", headers=auth())).status_code == 200
    assert (await client.get(path, headers=auth())).json()["context_revision"] == 4
    assert (await client.get(f"/projects/{q['id']}/sub-agents", headers=auth())).json()["context_revision"] == 3
    assert (await change(client, p, [b["id"]], revision=4)).status_code == 200
    assert (
        await client.delete(f"/projects/{p['id']}", headers=auth(), params={"expected_context_revision": 5})
    ).status_code == 200
    async with sessions() as db:
        assert list(await db.scalars(select(ProjectSubAgentModel))) == []
        assert await db.get(AgentProfileModel, uuid.UUID(b["id"])) is not None


@pytest.mark.asyncio
async def test_membership_api_auth_validation_and_concurrent_writes(project_api):
    client, _, _ = project_api
    p, a = await create(client), await worker(client)
    path = f"/projects/{p['id']}/sub-agents"
    for method in ["GET", "POST", "DELETE"]:
        assert (await client.request(method, path)).status_code == 401
    for payload in [
        {},
        {"agent_ids": [], "expected_context_revision": 1},
        {"agent_ids": [a["id"]], "expected_context_revision": 0},
        {"agent_ids": ["invalid"], "expected_context_revision": 1},
        {"agent_ids": [a["id"]], "expected_context_revision": 1, "user_id": "b"},
    ]:
        assert (await client.post(path, headers=auth(), json=payload)).status_code == 422
    for params in [{"page": 0}, {"page_size": 101}]:
        assert (await client.get(path, headers=auth(), params=params)).status_code == 422
    results = await asyncio.gather(change(client, p, [a["id"]]), change(client, p, [a["id"]]))
    assert sorted(r.status_code for r in results) == [200, 409]


@pytest.mark.asyncio
async def test_database_enforces_owner_role_uniqueness_and_updates(project_api):
    client, sessions, _ = project_api
    p, a, b = await create(client), await worker(client), await worker(client, user="b")
    main = (await client.get("/settings/user/main-agent", headers=auth())).json()
    async with sessions() as db:
        for agent_id, user_id, role in [
            (b["id"], "a", True),
            (a["id"], "b", True),
            (main["id"], "a", True),
            (main["id"], "a", False),
        ]:
            db.add(
                ProjectSubAgentModel(
                    project_id=uuid.UUID(p["id"]), agent_id=uuid.UUID(agent_id), user_id=user_id, sub_agent=role
                )
            )
            with pytest.raises(IntegrityError):
                await db.commit()
            await db.rollback()
    assert (await change(client, p, [a["id"]])).status_code == 200
    async with sessions() as db:
        for statement in [
            update(AgentProfileModel).where(AgentProfileModel.id == uuid.UUID(a["id"])).values(user_id="b"),
            update(AgentProfileModel)
            .where(AgentProfileModel.id == uuid.UUID(a["id"]))
            .values(sub_agent=False, model_id=None),
            update(ProjectModel).where(ProjectModel.id == uuid.UUID(p["id"])).values(user_id="b"),
        ]:
            with pytest.raises(IntegrityError):
                await db.execute(statement)
                await db.commit()
            await db.rollback()
        db.add(ProjectSubAgentModel(project_id=uuid.UUID(p["id"]), agent_id=uuid.UUID(a["id"]), user_id="a"))
        with pytest.raises(IntegrityError):
            await db.commit()
        await db.rollback()


async def runtime_setup(project_api, monkeypatch):
    client, sessions, _ = project_api
    p, q = await create(client), await create(client, "Other")
    a, b = await worker(client, "Allowed"), await worker(client, "Other worker")
    await change(client, p, [a["id"]])
    await change(client, q, [b["id"]])
    async with sessions() as db:
        await db.execute(update(LLMModel).values(supports_tools=True))
        db.add(ApplicationSettingsModel(key="active_tools", value=["sub_agent", "search_knowledge", "web_search"]))
        chat = ChatModel(user_id="a", project_id=uuid.UUID(p["id"]))
        db.add(chat)
        await db.commit()
        chat_id = chat.id
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def session_context(session=None):
        if session is not None:
            yield session
        else:
            async with sessions() as db:
                yield db

    monkeypatch.setattr("asterism.domains.chat.delegation.get_async_db_session", session_context)
    monkeypatch.setattr("asterism.domains.agent.service.get_async_db_session", session_context)
    return client, sessions, p, q, a, b, chat_id


async def _runtime_tool_scope(chat_id):
    from asterism.domains.agent.service import get_main_agent_profile
    from asterism.domains.chat.tool_policy import resolve_effective_tools

    profile = await get_main_agent_profile("a")
    _, ceiling = await resolve_effective_tools(user_id="a", chat_id=chat_id, profile=profile, model_id=uuid.UUID(int=2))
    return ceiling


@pytest.mark.asyncio
async def test_live_target_scope_general_moves_and_fixed_model(project_api, monkeypatch):
    client, sessions, p, q, a, b, chat_id = await runtime_setup(project_api, monkeypatch)
    scope = await resolve_delegation_scope(user_id="a", chat_id=chat_id)

    async def require(target=a["id"], ceiling=scope, user="a", **kwargs):
        return await require_delegation_target(
            user_id=user, chat_id=chat_id, scope=ceiling, target_id=uuid.UUID(target), **kwargs
        )

    assert (await require()).model_id == uuid.UUID(int=1)
    for target in [b["id"], str(uuid.uuid4())]:
        with pytest.raises(BadDataException):
            await require(target)
    with pytest.raises(BadDataException):
        await require(ceiling=None)
    with pytest.raises(BadDataException):
        await require(user="b")
    async with sessions() as db:
        await db.execute(update(ChatModel).where(ChatModel.id == chat_id).values(project_id=uuid.UUID(q["id"])))
        await db.commit()
    with pytest.raises(BadDataException):
        await require()
    next_scope = await resolve_delegation_scope(user_id="a", chat_id=chat_id)
    assert next_scope.agent_ids == frozenset({uuid.UUID(b["id"])})
    async with sessions() as db:
        await db.execute(update(ChatModel).where(ChatModel.id == chat_id).values(project_id=None))
        await db.commit()
    assert await resolve_delegation_scope(user_id="a", chat_id=chat_id) is None
    assert (await client.delete(f"/agents/sub-agents/{a['id']}", headers=auth())).status_code == 200
    with pytest.raises(BadDataException):
        await require()


@pytest.mark.asyncio
@pytest.mark.parametrize("revocation", ["deselect", "definition", "deleted", "model", "move", "project"])
async def test_revocation_cancels_silent_child_and_rejects_output(project_api, monkeypatch, revocation):
    from unittest.mock import MagicMock

    client, sessions, p, q, a, b, chat_id = await runtime_setup(project_api, monkeypatch)
    scope = await resolve_delegation_scope(user_id="a", chat_id=chat_id)
    started, closed = asyncio.Event(), asyncio.Event()

    async def silent_run(self, messages):
        assert self.delegation_scope is scope
        assert self.model_id == uuid.UUID(int=1)
        assert self.user_files == ["authorized.txt"]
        started.set()
        try:
            await asyncio.Event().wait()
            yield
        finally:
            closed.set()

    monkeypatch.setattr(Agent, "run", silent_run)
    ctx = ToolContext(
        args=SubAgentArgs(agent_id=uuid.UUID(a["id"]), prompt="Work"),
        user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
        user_message="",
        session=Chat(
            info=ChatInfo(id=chat_id, user_id="a", project_id=uuid.UUID(p["id"]), created_at=0, updated_at=0),
            messages=[],
        ),
        app_settings=MagicMock(),
        client=MagicMock(),
        delegation_scope=scope,
        tool_scope=await _runtime_tool_scope(chat_id),
        user_files=["authorized.txt"],
    )
    task = asyncio.create_task(sub_agent(ctx))
    await asyncio.wait_for(started.wait(), 2)
    if revocation == "deselect":
        await change(client, p, [a["id"]], revision=2, method="DELETE")
    elif revocation == "deleted":
        await client.delete(f"/agents/sub-agents/{a['id']}", headers=auth())
    elif revocation == "definition":
        await client.put(
            f"/agents/sub-agents/{a['id']}", headers=auth(), json={"name": "Changed", "model_id": str(uuid.UUID(int=1))}
        )
    elif revocation == "project":
        await client.delete(f"/projects/{p['id']}", headers=auth(), params={"expected_context_revision": 2})
    else:
        async with sessions() as db:
            if revocation == "model":
                await db.execute(update(LLMModel).where(LLMModel.id == uuid.UUID(int=1)).values(is_active=False))
            else:
                await db.execute(update(ChatModel).where(ChatModel.id == chat_id).values(project_id=uuid.UUID(q["id"])))
            await db.commit()
    result = await asyncio.wait_for(task, 2)
    assert "failed" in result.lower()
    assert closed.is_set()


@pytest.mark.asyncio
async def test_runtime_prompt_only_advertises_selected_targets_and_general_has_no_tool(project_api, monkeypatch):
    from unittest.mock import AsyncMock

    from asterism.domains.llm.schemas import LLMEvent, LLMEventType, LLMMessage

    client, sessions, p, q, a, b, chat_id = await runtime_setup(project_api, monkeypatch)
    from asterism.domains.agent.service import get_main_agent_profile

    profile = await get_main_agent_profile("a")
    user = AuthedUser(id="a", email="a@x.test", name="A", role="user")
    chat = Chat(info=ChatInfo(id=chat_id, user_id="a", created_at=0, updated_at=0), messages=[])
    agent = Agent(profile=profile, user=user, session=chat, model_id=uuid.UUID(int=2))
    prompt = await agent._build_system_prompt()
    assert a["id"] in prompt and b["id"] not in prompt
    scope = agent.delegation_scope
    assert (await change(client, p, [b["id"]], revision=2)).status_code == 200
    with pytest.raises(BadDataException):
        await require_delegation_target(user_id="a", chat_id=chat_id, scope=scope, target_id=uuid.UUID(b["id"]))
    async with sessions() as db:
        await db.execute(update(ChatModel).where(ChatModel.id == chat_id).values(project_id=None))
        await db.commit()

    class Client:
        async def chat(self, messages, tools, **kwargs):
            assert "sub_agent" not in tools
            yield LLMEvent(type=LLMEventType.COMPLETE, content="Done", finish_reason="stop")

    monkeypatch.setattr(agent, "_get_client", AsyncMock(return_value=Client()))
    assert [e async for e in agent.run([LLMMessage.user("Hello")])][-1].content == "Done"
    assert agent.delegation_scope is None


@pytest.mark.asyncio
async def test_unavailable_models_remain_selected_but_cannot_delegate(project_api, monkeypatch):
    from asterism.domains.chat.delegation import eligible_delegation_targets

    client, sessions, p, q, a, b, chat_id = await runtime_setup(project_api, monkeypatch)
    scope = await resolve_delegation_scope(user_id="a", chat_id=chat_id)
    async with sessions() as db:
        await db.execute(update(LLMModel).where(LLMModel.id == uuid.UUID(int=1)).values(is_active=False))
        await db.commit()
    listing = (await client.get(f"/projects/{p['id']}/sub-agents", headers=auth())).json()
    assert listing["total"] == 1 and not listing["agents"][0]["model_available"]
    assert await eligible_delegation_targets(user_id="a", chat_id=chat_id, scope=scope) == []
    with pytest.raises(BadDataException, match="unavailable"):
        await require_delegation_target(user_id="a", chat_id=chat_id, scope=scope, target_id=uuid.UUID(a["id"]))


@pytest.mark.asyncio
async def test_direct_tool_invocation_in_general_and_unselected_target_fails_closed(project_api, monkeypatch):
    from unittest.mock import MagicMock

    client, sessions, p, q, a, b, chat_id = await runtime_setup(project_api, monkeypatch)

    async def forbidden(*args, **kwargs):
        pytest.fail("An unauthorized child was constructed")
        yield

    monkeypatch.setattr(Agent, "run", forbidden)
    chat = Chat(info=ChatInfo(id=chat_id, user_id="a", created_at=0, updated_at=0), messages=[])
    user = AuthedUser(id="a", email="a@x.test", name="A", role="user")
    scope = await resolve_delegation_scope(user_id="a", chat_id=chat_id)
    for ceiling, target in [(None, a["id"]), (scope, b["id"])]:
        ctx = ToolContext(
            args=SubAgentArgs(agent_id=uuid.UUID(target), prompt="Forged target"),
            user=user,
            user_message="",
            session=chat,
            app_settings=MagicMock(),
            client=MagicMock(),
            delegation_scope=ceiling,
            tool_scope=await _runtime_tool_scope(chat_id),
        )
        assert "rejected" in (await sub_agent(ctx)).lower()


@pytest.mark.asyncio
async def test_revocation_cancels_pending_child_tool_work(project_api, monkeypatch):
    from unittest.mock import AsyncMock

    from asterism.domains.llm.schemas import Function, LLMEvent, LLMEventType, LLMMessage, ToolCall
    from asterism.domains.tools.builtin.sub_agent import _authorized_events
    from asterism.domains.tools.registry import tool_registry

    client, sessions, p, q, a, b, chat_id = await runtime_setup(project_api, monkeypatch)
    scope = await resolve_delegation_scope(user_id="a", chat_id=chat_id)
    async with sessions() as db:
        await db.execute(
            update(AgentProfileModel).where(AgentProfileModel.id == uuid.UUID(a["id"])).values(tools=["web_search"])
        )
        await db.commit()
    profile = await require_delegation_target(user_id="a", chat_id=chat_id, scope=scope, target_id=uuid.UUID(a["id"]))

    async def check():
        await require_delegation_target(
            user_id="a", chat_id=chat_id, scope=scope, target_id=profile.id, config_revision=profile.config_revision
        )

    started, closed = asyncio.Event(), asyncio.Event()

    async def pending_tool(**kwargs):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            closed.set()

    class Client:
        async def chat(self, messages, tools, **kwargs):
            yield LLMEvent(
                type=LLMEventType.COMPLETE,
                content="",
                tool_calls=[ToolCall(id="wait", function=Function(name="web_search", arguments="{}"))],
                finish_reason="tool_calls",
            )

    monkeypatch.setattr(tool_registry, "invoke_tool", pending_tool)
    child = Agent(
        profile=profile.model_copy(update={"tools": ["web_search"]}),
        user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
        session=Chat(info=ChatInfo(id=chat_id, user_id="a", created_at=0, updated_at=0), messages=[]),
        allowed_tools=["web_search"],
        authorization_check=check,
        delegation_scope=scope,
        tool_scope=replace(await _runtime_tool_scope(chat_id), caller_agent_id=profile.id, model_id=profile.model_id),
    )
    monkeypatch.setattr(child, "_get_client", AsyncMock(return_value=Client()))

    async def collect():
        return [e async for e in _authorized_events(child.run([LLMMessage.user("Work")]), check)]

    task = asyncio.create_task(collect())
    await asyncio.wait_for(started.wait(), 2)
    await change(client, p, [a["id"]], revision=2, method="DELETE")
    with pytest.raises(BadDataException):
        await asyncio.wait_for(task, 2)
    assert closed.is_set()
