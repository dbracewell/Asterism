"""Live internal-tool policy and retrieval boundaries, using production DB readers."""

import uuid
from contextlib import asynccontextmanager
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from asterism.core.exceptions import BadDataException
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.execution_scope import ExecutionScope, ModelIdentity
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.service import get_agent_profile, get_main_agent_profile
from asterism.domains.chat.models import ChatModel
from asterism.domains.chat.retrieval import create_retrieval_service
from asterism.domains.chat.schemas import Chat, ChatInfo
from asterism.domains.chat.tool_policy import require_internal_tool, resolve_effective_tools
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel, KnowledgeExtractionStatus
from asterism.domains.projects.models import ProjectFileModel
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel
from asterism.domains.tools.builtin.search_knowledge import SearchKnowledgeArgs, search_knowledge
from asterism.domains.tools.catalog import ToolPolicy
from asterism.domains.tools.registry import ToolContext, tool_registry
from sqlalchemy import delete, update
from test_project_sub_agents import change, runtime_setup
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api


@pytest_asyncio.fixture
async def context_runtime(project_api, monkeypatch):
    client, sessions, p, q, a, b, chat_id = await runtime_setup(project_api, monkeypatch)

    @asynccontextmanager
    async def session_context(session=None):
        if session is not None:
            yield session
        else:
            async with sessions() as db:
                yield db

    monkeypatch.setattr("asterism.domains.chat.retrieval.get_async_db_session", session_context)
    async with sessions() as db:
        await db.execute(
            update(ApplicationSettingsModel)
            .where(ApplicationSettingsModel.key == "active_tools")
            .values(value=["sub_agent", "search_knowledge", "web_search"])
        )
        await db.commit()
    profile = await get_main_agent_profile("a")
    user = AuthedUser(id="a", email="a@x.test", name="A", role="user")
    chat = Chat(info=ChatInfo(id=chat_id, user_id="a", created_at=0, updated_at=0), messages=[])
    return SimpleNamespace(
        client=client, sessions=sessions, p=p, q=q, a=a, b=b, chat_id=chat_id, profile=profile, user=user, chat=chat
    )


async def resolve(r, **kwargs):
    return await resolve_effective_tools(
        user_id="a", chat_id=r.chat_id, profile=r.profile, model_id=uuid.UUID(int=2), **kwargs
    )


async def add_file(r, *, project=True, status="ready", owner="a"):
    async with r.sessions() as db:
        f = UserFileModel(
            user_id=owner,
            storage_key=str(uuid.uuid4()),
            filename=str(uuid.uuid4()) + ".txt",
            original_name="notes.txt",
            size=1,
            mime_type="text/plain",
            kind=FileKind.TEXT,
            sha256="a" * 64,
        )
        db.add(f)
        await db.flush()
        if project:
            db.add(ProjectFileModel(project_id=uuid.UUID(r.p["id"]), user_id=owner, file_id=f.id))
        if status is not None:
            db.add(
                FileKnowledgeArtifactModel(
                    user_id=owner,
                    file_id=f.id,
                    generation=1,
                    processing_profile_generation=1,
                    status=KnowledgeExtractionStatus(status),
                    is_current=True,
                    searchable=status == "ready",
                )
            )
        await db.commit()
        return f.id


def ctx(r, scope):
    return ToolContext(
        args=SearchKnowledgeArgs(query="facts"),
        user=r.user,
        user_message="",
        session=r.chat,
        app_settings=MagicMock(),
        client=MagicMock(),
        tool_scope=scope,
        execution_scope=make_execution_scope(r, scope),
        retrieval_service=create_retrieval_service(ceiling=scope),
    )


def make_execution_scope(r, scope):
    if scope is None:
        return None
    delegation = scope.delegation
    return ExecutionScope(
        user_id=scope.user_id,
        user_profile_id=None,
        agent_id=scope.caller_agent_id,
        is_sub_agent=False,
        chat_id=scope.chat_id,
        project_id=scope.project_id,
        selected_model=None,
        executed_model=ModelIdentity(id=scope.model_id),
        eligible_sub_agent_ids=(delegation.agent_ids if delegation else frozenset()) | {uuid.UUID(r.a["id"])},
        effective_internal_tools=frozenset({"search_knowledge", "sub_agent"}),
        active_branch_message_ids=(),
        configuration_revision=r.profile.config_revision,
        prompt_revision=delegation.context_revision if delegation else None,
        allowed_file_ids=scope.file_ids,
        file_provenance=(),
    )


@pytest.mark.asyncio
async def test_internal_tools_hidden_from_users_admin_metadata_and_forged_settings(context_runtime, monkeypatch):
    import asterism.domains.tools.builtin.web_search  # noqa: F401

    r = context_runtime
    assert r.profile.tools == []
    monkeypatch.setattr(
        "asterism.domains.tools.router.get_app_settings",
        AsyncMock(return_value=SimpleNamespace(active_tools=["sub_agent", "search_knowledge", "web_search"])),
    )
    active = (await r.client.get("/tools/active", headers=auth())).json()
    assert [t["name"] for t in active["items"]] == ["web_search"]
    assert tool_registry["sub_agent"].policy == ToolPolicy.CONTEXT_MANAGED
    assert tool_registry["search_knowledge"].policy == ToolPolicy.CONTEXT_MANAGED
    assert (await r.client.get("/tools/all", headers=auth())).status_code == 401
    all_tools = tool_registry.tools()
    assert {t.name for t in all_tools.items if t.policy == ToolPolicy.CONTEXT_MANAGED} == {
        "sub_agent",
        "search_knowledge",
    }
    for name in ["sub_agent", "search_knowledge"]:
        assert (
            await r.client.put("/settings/user/main-agent", headers=auth(), json={"tools": [name]})
        ).status_code == 400
        assert (
            await r.client.post(
                "/agents/sub-agents",
                headers=auth(),
                json={"name": "Forged", "model_id": str(uuid.UUID(int=1)), "tools": [name]},
            )
        ).status_code == 400
        assert (
            await r.client.post(
                "/chat/",
                headers=auth(),
                json={
                    "request_id": str(uuid.uuid4()),
                    "model_id": str(uuid.UUID(int=2)),
                    "user_prompt": "Hi",
                    "allowed_tools": [name],
                },
            )
        ).status_code == 422


@pytest.mark.asyncio
async def test_automatic_delegation_empty_general_admin_model_and_ordinary_policy(context_runtime):
    r = context_runtime
    names, scope = await resolve(r)
    assert names == ["sub_agent"]
    assert scope.file_ids == frozenset()
    async with r.sessions() as db:
        await db.execute(
            update(AgentProfileModel).where(AgentProfileModel.id == r.profile.id).values(tools=["web_search"])
        )
        await db.commit()
    r.profile = await get_main_agent_profile("a")
    assert (await resolve(r))[0] == ["sub_agent", "web_search"]
    for flag in [False, None]:
        async with r.sessions() as db:
            await db.execute(update(LLMModel).where(LLMModel.id == uuid.UUID(int=2)).values(supports_tools=flag))
            await db.commit()
        assert (await resolve(r))[0] == []
        with pytest.raises(BadDataException):
            await require_internal_tool(name="sub_agent", user_id="a", chat_id=r.chat_id, scope=scope)
    async with r.sessions() as db:
        await db.execute(update(LLMModel).values(supports_tools=True))
        await db.execute(
            update(ApplicationSettingsModel)
            .where(ApplicationSettingsModel.key == "active_tools")
            .values(value=["web_search"])
        )
        await db.commit()
    assert (await resolve(r))[0] == ["web_search"]
    async with r.sessions() as db:
        await db.execute(
            update(ApplicationSettingsModel)
            .where(ApplicationSettingsModel.key == "active_tools")
            .values(value=["sub_agent", "search_knowledge", "web_search"])
        )
        await db.commit()
    await change(r.client, r.p, [r.a["id"]], revision=2, method="DELETE")
    assert "sub_agent" not in (await resolve(r))[0]
    async with r.sessions() as db:
        await db.execute(update(ChatModel).where(ChatModel.id == r.chat_id).values(project_id=None))
        await db.commit()
    assert (await resolve(r))[0] == ["web_search"]


@pytest.mark.asyncio
async def test_retrieval_ready_pending_failed_unavailable_and_ceiling(context_runtime, monkeypatch):
    r = context_runtime
    ids = [await add_file(r, status=status) for status in ["ready", "pending", "failed", None]]
    unrelated = await add_file(r, project=False)
    foreign = await add_file(r, project=False, owner="b")
    names, scope = await resolve(r)
    assert names == ["search_knowledge", "sub_agent"]
    embed = AsyncMock(return_value=[[0.1]])
    matches = [
        SimpleNamespace(
            user_id="a",
            file_id=str(fid),
            artifact_generation=gen,
            id="chunk",
            kind="text",
            score=1.0,
            content="évidence",
        )
        for fid, gen in [(ids[0], 1), (ids[0], 0), (ids[1], 1), (unrelated, 1), (foreign, 1)]
    ]
    search = AsyncMock(return_value=matches)
    monkeypatch.setattr("asterism.domains.chat.retrieval.embedding_provider.embed_text", embed)
    monkeypatch.setattr("asterism.domains.chat.retrieval.vector_store.search", search)
    result = await search_knowledge(ctx(r, scope))
    assert [hit["file_id"] for hit in result["results"]] == [str(ids[0])]
    assert result["results"][0]["sources"] == ["project"]
    assert {state["status"] for state in result["file_states"]} == {"ready", "pending", "failed", "unavailable"}
    assert search.call_args.kwargs["allowed_file_ids"] == [str(ids[0])]
    # New membership cannot widen an existing child/turn ceiling.
    later = await add_file(r)
    assert later not in scope.file_ids
    unavailable_result = await search_knowledge(ctx(r, replace(scope, file_ids=frozenset({ids[1], ids[2], ids[3]}))))
    assert {key: unavailable_result[key] for key in ("results", "message", "file_states")} == {
        "results": [],
        "message": "No searchable artifacts are ready; files may be pending, failed, or unavailable.",
        "file_states": sorted(
            [
                {"file_id": str(ids[1]), "status": "pending"},
                {"file_id": str(ids[2]), "status": "failed"},
                {"file_id": str(ids[3]), "status": "unavailable"},
            ],
            key=lambda x: x["file_id"],
        ),
    }
    with pytest.raises(BadDataException):
        await search_knowledge(ctx(r, replace(scope, file_ids=frozenset())))
    with pytest.raises(BadDataException):
        await search_knowledge(ctx(r, None))


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["embedding", "vector"])
async def test_file_revocation_during_retrieval_never_queries_or_returns_revoked_file(
    context_runtime, monkeypatch, stage
):
    r = context_runtime
    fid = await add_file(r)
    _, scope = await resolve(r)

    async def revoke():
        async with r.sessions() as db:
            await db.execute(delete(ProjectFileModel).where(ProjectFileModel.file_id == fid))
            await db.commit()

    async def embed(*args, **kwargs):
        if stage == "embedding":
            await revoke()
        return [[0.1]]

    async def vector(*args, **kwargs):
        assert stage == "vector"
        await revoke()
        return [
            SimpleNamespace(
                user_id="a",
                file_id=str(fid),
                artifact_generation=1,
                id="chunk",
                kind="text",
                score=1.0,
                content="PRIVATE",
            )
        ]

    query = AsyncMock(side_effect=vector)
    monkeypatch.setattr("asterism.domains.chat.retrieval.embedding_provider.embed_text", embed)
    monkeypatch.setattr("asterism.domains.chat.retrieval.vector_store.search", query)
    with pytest.raises(BadDataException):
        await search_knowledge(ctx(r, scope))
    if stage == "embedding":
        query.assert_not_called()


@pytest.mark.asyncio
async def test_child_context_never_widens_files_or_targets(context_runtime):
    r = context_runtime
    fid = await add_file(r)
    _, scope = await resolve(r)
    child = await get_agent_profile("a", uuid.UUID(r.a["id"]))
    child_scope = replace(scope, caller_agent_id=child.id, model_id=child.model_id)
    names, ceiling = await resolve_effective_tools(
        user_id="a", chat_id=r.chat_id, profile=child, model_id=child.model_id, ceiling=child_scope
    )
    assert names == ["search_knowledge"]  # Only the already-running child is selected; self-recursion is unavailable.
    assert ceiling.file_ids == frozenset({fid}) and ceiling.delegation is scope.delegation
    assert (await resolve_effective_tools(user_id="a", chat_id=r.chat_id, profile=child, model_id=child.model_id))[
        0
    ] == []


@pytest.mark.asyncio
async def test_general_attachment_retrieval_no_delegation_and_unavailable_service(context_runtime, monkeypatch):
    r = context_runtime
    fid = await add_file(r, project=False)
    response = await r.client.post(
        "/chat/",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Use file",
            "model_id": str(uuid.UUID(int=2)),
            "files": [str(fid)],
        },
    )
    assert response.status_code == 200, response.text
    general = Chat.model_validate(response.json())
    names, scope = await resolve_effective_tools(
        user_id="a", chat_id=general.info.id, profile=r.profile, model_id=uuid.UUID(int=2)
    )
    assert names == ["search_knowledge"] and scope.delegation is None
    r.chat = general
    embed = AsyncMock(side_effect=RuntimeError("service unavailable"))
    monkeypatch.setattr("asterism.domains.chat.retrieval.embedding_provider.embed_text", embed)
    result = await search_knowledge(ctx(r, scope))
    assert result["results"] == [] and "unavailable" in result["message"]
    from asterism.domains.llm.schemas import Function, ToolCall

    direct = await tool_registry.invoke_tool(
        tool_call=ToolCall(id="forged", function=Function(name="search_knowledge", arguments='{"query":"facts"}')),
        user=r.user,
        client=MagicMock(),
        session=r.chat,
        app_settings=SimpleNamespace(active_tools=["sub_agent", "search_knowledge"]),
        max_retries=0,
    )
    assert "unavailable" in direct.content


@pytest.mark.asyncio
@pytest.mark.parametrize("revocation", ["admin", "parent_model"])
async def test_internal_policy_revocation_cancels_active_delegation(context_runtime, monkeypatch, revocation):
    import asyncio

    from asterism.domains.tools.builtin.sub_agent import SubAgentArgs, sub_agent

    r = context_runtime
    _, scope = await resolve(r)
    started, closed = asyncio.Event(), asyncio.Event()

    async def silent(self, messages):
        started.set()
        try:
            await asyncio.Event().wait()
            yield
        finally:
            closed.set()

    monkeypatch.setattr(Agent, "run", silent)
    request = ToolContext(
        args=SubAgentArgs(agent_id=uuid.UUID(r.a["id"]), prompt="Work"),
        user=r.user,
        user_message="",
        session=r.chat,
        client=MagicMock(),
        app_settings=MagicMock(),
        tool_scope=scope,
        delegation_scope=scope.delegation,
        execution_scope=make_execution_scope(r, scope),
    )
    task = asyncio.create_task(sub_agent(request))
    started_task = asyncio.create_task(started.wait())
    done, _ = await asyncio.wait({task, started_task}, timeout=2, return_when=asyncio.FIRST_COMPLETED)
    if task in done:
        await task
    assert started.is_set()
    async with r.sessions() as db:
        if revocation == "admin":
            await db.execute(
                update(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "active_tools").values(value=[])
            )
        else:
            await db.execute(update(LLMModel).where(LLMModel.id == uuid.UUID(int=2)).values(supports_tools=False))
        await db.commit()
    assert "failed" in (await asyncio.wait_for(task, 2)).lower()
    assert closed.is_set()
