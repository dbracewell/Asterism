"""Shared retrieval and runtime file authorization, including in-flight revocation."""

import uuid
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from asterism.core import config
from asterism.core.exceptions import BadDataException
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.execution_scope import ModelIdentity
from asterism.domains.agent.service import get_agent_profile
from asterism.domains.chat.models import MessageModel
from asterism.domains.chat.retrieval import create_retrieval_service
from asterism.domains.chat.runtime_files import create_runtime_file_reader
from asterism.domains.chat.schemas import Chat, MessageStatus
from asterism.domains.chat.tool_policy import resolve_effective_tools
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.files.store import get_file_store
from asterism.domains.knowledge.models import (
    FileKnowledgeArtifactModel,
    FileKnowledgeExtractionModel,
    KnowledgeExtractionKind,
    KnowledgeExtractionStatus,
)
from asterism.domains.knowledge.vector_store import LanceDbVectorStore, VectorChunk, VectorSearchResult
from asterism.domains.retrieval.service import RetrievalLimits, RetrievalService
from sqlalchemy import delete, select, update
from test_context_tools import add_file, make_execution_scope
from test_context_tools import context_runtime as _context_runtime
from test_project_sub_agents import change
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
context_runtime = _context_runtime


async def execution(r):
    _, ceiling = await resolve_effective_tools(
        user_id="a", chat_id=r.chat_id, profile=r.profile, model_id=uuid.UUID(int=2)
    )
    return make_execution_scope(r, ceiling), ceiling


def match(fid, *, owner="a", generation=1, content="Evidence", ordinal=0, kind="text"):
    return VectorSearchResult(
        id=f"{fid}-{ordinal}",
        user_id=owner,
        file_id=str(fid),
        artifact_generation=generation,
        chunk_ordinal=ordinal,
        kind=kind,
        content=content,
        score=0.1,
    )


@pytest.mark.asyncio
async def test_database_vector_prefilter_and_result_provenance(context_runtime, monkeypatch, tmp_path):
    r = context_runtime
    project = await add_file(r)
    local = await add_file(r, project=False)
    unrelated = await add_file(r, project=False)
    foreign = await add_file(r, project=False, owner="b")
    response = await r.client.post(
        "/chat/",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Use both",
            "model_id": str(uuid.UUID(int=2)),
            "project_id": r.p["id"],
            "files": [str(project), str(local)],
        },
    )
    assert response.status_code == 200, response.text
    r.chat = Chat.model_validate(response.json())
    r.chat_id = r.chat.info.id
    scope, ceiling = await execution(r)
    store = LanceDbVectorStore(tmp_path / "vectors", dimension=2)
    await store.add(
        [
            VectorChunk(
                id=str(fid),
                user_id=owner,
                file_id=str(fid),
                artifact_generation=1,
                chunk_ordinal=0,
                kind="text",
                content=content,
                vector=[1.0, 0.0],
            )
            for fid, owner, content in [
                (project, "a", "Project evidence"),
                (local, "a", "Chat evidence"),
                (unrelated, "a", "PRIVATE unrelated"),
                (foreign, "b", "PRIVATE foreign"),
            ]
        ]
    )
    root = create_retrieval_service(ceiling=ceiling)
    service = RetrievalService(
        read_scope=root.read_scope,
        embeddings=SimpleNamespace(embed_text=AsyncMock(return_value=[[1.0, 0.0]])),
        vectors=store,
        limits=root.limits,
    )
    result = await service.search(scope, query="evidence", top_k=5)
    assert {hit.file_id for hit in result.results} == {project, local}
    # Query vectors are identical to the stored unit vectors: distance 0 -> similarity 1.
    assert all(hit.score == pytest.approx(1.0) for hit in result.results)
    assert "PRIVATE" not in result.model_dump_json()
    shared = next(hit for hit in result.results if hit.file_id == project)
    assert shared.sources == ("project", "chat") and shared.message_ids == (r.chat.messages[0].id,)
    assert result.scope["chat_id"] == str(scope.chat_id) and result.scope["project_id"] == r.p["id"]
    assert result.scope["executed_model_id"] == str(uuid.UUID(int=2))
    assert result.provenance.chat_id == scope.chat_id
    assert result.provenance.project_id == scope.project_id
    assert result.provenance.configurations[0].agent_id == scope.agent_id
    assert "Project evidence" not in result.provenance.model_dump_json()
    await store.close()


@pytest.mark.asyncio
async def test_foreign_matches_limits_caption_and_utf8_budget(context_runtime, monkeypatch):
    r = context_runtime
    fid = await add_file(r)
    async with r.sessions() as db:
        artifact_id = await db.scalar(
            select(FileKnowledgeArtifactModel.id).where(FileKnowledgeArtifactModel.file_id == fid)
        )
        db.add(
            FileKnowledgeExtractionModel(
                artifact_id=artifact_id,
                kind=KnowledgeExtractionKind.CAPTIONING,
                status=KnowledgeExtractionStatus.READY,
                payload={"text": "ééé"},
            )
        )
        await db.commit()
    scope, ceiling = await execution(r)
    root = create_retrieval_service(ceiling=ceiling)
    embeddings = SimpleNamespace(embed_text=AsyncMock(return_value=[[0.1]]))
    vectors = SimpleNamespace(
        search=AsyncMock(
            return_value=[
                match(fid, owner="b", content="PRIVATE"),
                match(fid, generation=0),
                match(fid, content="ééé", kind="caption"),
                match(fid, ordinal=1),
            ]
        )
    )
    service = RetrievalService(
        read_scope=root.read_scope,
        embeddings=embeddings,
        vectors=vectors,
        limits=RetrievalLimits(top_k=2, allowed_files=10, result_bytes=5),
    )
    result = await service.search(scope, query="caption", top_k=2)
    assert [(hit.match_kind, hit.excerpt) for hit in result.results] == [("caption", "éé"), ("text", "E")]
    # Mocked store distance 0.1 over unit vectors -> similarity 1 - 0.1 / 2.
    assert all(hit.score == pytest.approx(0.95) for hit in result.results)
    assert vectors.search.call_args.kwargs == {"user_id": "a", "allowed_file_ids": [str(fid)], "limit": 2}
    embeddings.embed_text.reset_mock()
    clamped = await service.search(scope, query="caption", top_k=3)
    assert clamped.message is None
    assert [(hit.match_kind, hit.excerpt) for hit in clamped.results] == [("caption", "éé"), ("text", "E")]
    for invalid in [replace(scope, allowed_file_ids=frozenset()), replace(scope, effective_internal_tools=frozenset())]:
        with pytest.raises(BadDataException):
            await service.search(invalid, query="caption")


@pytest.mark.asyncio
async def test_ready_without_text_embeddings_reports_not_searchable(context_runtime):
    r = context_runtime
    fid = await add_file(r)
    async with r.sessions() as db:
        await db.execute(
            update(FileKnowledgeArtifactModel).where(FileKnowledgeArtifactModel.file_id == fid).values(searchable=False)
        )
        await db.commit()
    scope, ceiling = await execution(r)
    root = create_retrieval_service(ceiling=ceiling)
    result = await root.search(scope, query="anything")
    assert result.results == [] and "No searchable artifacts" in result.message
    # The file exists but its text was never embedded: a distinct state, not "unavailable".
    assert [state["status"] for state in result.file_states] == ["not_searchable"]


@pytest.mark.asyncio
@pytest.mark.parametrize("returned_generation", [1, 2])
async def test_replacement_during_vector_search_never_releases_a_new_or_old_generation(
    context_runtime,
    monkeypatch,
    returned_generation,
):
    r = context_runtime
    fid = await add_file(r)
    scope, ceiling = await execution(r)

    async def search(*args, **kwargs):
        async with r.sessions() as db:
            await db.execute(
                update(FileKnowledgeArtifactModel)
                .where(FileKnowledgeArtifactModel.file_id == fid)
                .values(is_current=False)
            )
            db.add(
                FileKnowledgeArtifactModel(
                    user_id="a",
                    file_id=fid,
                    generation=2,
                    processing_profile_generation=1,
                    status=KnowledgeExtractionStatus.READY,
                    is_current=True,
                    searchable=True,
                )
            )
            await db.commit()
        return [match(fid, generation=returned_generation)]

    root = create_retrieval_service(ceiling=ceiling)
    service = RetrievalService(
        read_scope=root.read_scope,
        embeddings=SimpleNamespace(embed_text=AsyncMock(return_value=[[0.1]])),
        vectors=SimpleNamespace(search=search),
        limits=root.limits,
    )
    assert (await service.search(scope, query="evidence")).results == []


@pytest.mark.asyncio
async def test_revocation_wins_over_embedding_failure(context_runtime):
    r = context_runtime
    fid = await add_file(r)
    scope, ceiling = await execution(r)

    async def embed(*args):
        from asterism.domains.projects.models import ProjectFileModel

        async with r.sessions() as db:
            await db.execute(delete(ProjectFileModel).where(ProjectFileModel.file_id == fid))
            await db.commit()
        raise RuntimeError("provider failed")

    root = create_retrieval_service(ceiling=ceiling)
    vectors = SimpleNamespace(search=AsyncMock())
    service = RetrievalService(
        read_scope=root.read_scope, embeddings=SimpleNamespace(embed_text=embed), vectors=vectors, limits=root.limits
    )
    with pytest.raises(BadDataException):
        await service.search(scope, query="evidence")
    vectors.search.assert_not_called()


async def store_file(r, fid, content=b"Private data", *, image=False):
    async with r.sessions() as db:
        file = await db.get(UserFileModel, fid)
        file.storage_key = get_file_store().save("a", fid, ".png" if image else ".txt", content)
        file.size = len(content)
        if image:
            file.kind, file.mime_type = FileKind.IMAGE, "image/png"
        await db.commit()


@pytest.mark.asyncio
async def test_direct_reads_require_scope_not_just_ownership_and_delegate_cannot_widen(
    context_runtime, monkeypatch, tmp_path
):
    r = context_runtime
    monkeypatch.setattr(config, "storage_root", tmp_path)
    fid, unrelated, foreign = (
        await add_file(r),
        await add_file(r, project=False),
        await add_file(r, project=False, owner="b"),
    )
    await store_file(r, fid)
    scope, ceiling = await execution(r)
    reader = create_runtime_file_reader(ceiling=ceiling)
    assert (await reader.read_for_model(scope, fid, supports_vision=False)).text == "Private data"
    for denied in [unrelated, foreign]:
        with pytest.raises(BadDataException):
            await reader.read_for_model(scope, denied, supports_vision=True)
    child = await get_agent_profile("a", uuid.UUID(r.a["id"]))
    child_scope = scope.narrow_for_sub_agent(
        agent_id=child.id,
        executed_model=ModelIdentity(id=child.model_id),
        configuration_revision=child.config_revision,
        effective_internal_tools=frozenset({"search_knowledge"}),
    )
    child_reader = create_runtime_file_reader(
        ceiling=replace(ceiling, caller_agent_id=child.id, model_id=child.model_id)
    )
    assert (await child_reader.read_for_model(child_scope, fid, supports_vision=False)).text == "Private data"
    with pytest.raises(BadDataException):
        await child_reader.read_for_model(
            replace(child_scope, allowed_file_ids=child_scope.allowed_file_ids | {unrelated}),
            unrelated,
            supports_vision=False,
        )
    await change(r.client, r.p, [r.a["id"]], revision=2, method="DELETE")
    with pytest.raises(BadDataException):
        await child_reader.read_for_model(child_scope, fid, supports_vision=False)


@pytest.mark.asyncio
async def test_image_routing_size_limit_and_post_read_revocation(context_runtime, monkeypatch, tmp_path):
    from asterism.domains.projects.models import ProjectFileModel

    r = context_runtime
    monkeypatch.setattr(config, "storage_root", tmp_path)
    fid = await add_file(r)
    await store_file(r, fid, b"image bytes", image=True)
    scope, ceiling = await execution(r)
    reader = create_runtime_file_reader(ceiling=ceiling)
    assert "does not support" in (await reader.read_for_model(scope, fid, supports_vision=False)).reason
    assert (await reader.read_for_model(scope, fid, supports_vision=True)).image_url.startswith(
        "data:image/png;base64,"
    )
    reader.max_image_bytes = 3
    assert "too large" in (await reader.read_for_model(scope, fid, supports_vision=True)).reason
    reader.max_image_bytes = config.max_vision_image_bytes
    original = reader.authorize
    calls = 0

    async def authorize(current):
        nonlocal calls
        calls += 1
        if calls == 3:
            async with r.sessions() as db:
                await db.execute(delete(ProjectFileModel).where(ProjectFileModel.file_id == fid))
                await db.commit()
        return await original(current)

    reader.authorize = authorize
    with pytest.raises(BadDataException):
        await reader.read_for_model(scope, fid, supports_vision=True)
    assert calls == 3


@pytest.mark.asyncio
async def test_cancelled_and_replaced_turns_cannot_read_or_retrieve(context_runtime, monkeypatch, tmp_path):
    r = context_runtime
    monkeypatch.setattr(config, "storage_root", tmp_path)
    fid = await add_file(r)
    await store_file(r, fid)
    response = await r.client.post(
        "/chat/",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Use file",
            "model_id": str(uuid.UUID(int=2)),
            "project_id": r.p["id"],
            "files": [str(fid)],
        },
    )
    chat = Chat.model_validate(response.json())
    agent = Agent(profile=r.profile, user=r.user, session=chat, model_id=uuid.UUID(int=2))
    await agent.prepare_execution(chat.messages[0].id)
    old = await agent.prepare_execution_scope()
    service = create_retrieval_service(ceiling=agent.tool_scope)
    reader = create_runtime_file_reader(ceiling=agent.tool_scope)
    async with r.sessions() as db:
        await db.execute(
            update(MessageModel).where(MessageModel.id == chat.messages[0].id).values(status=MessageStatus.CANCELLED)
        )
        await db.commit()
    with pytest.raises(BadDataException, match="canceled or replaced"):
        await reader.read_for_model(old, fid, supports_vision=False)
    with pytest.raises(BadDataException, match="canceled or replaced"):
        await service.search(old, query="facts")
    async with r.sessions() as db:
        await db.execute(
            update(MessageModel).where(MessageModel.id == chat.messages[0].id).values(status=MessageStatus.PENDING)
        )
        await db.commit()
    await agent.prepare_execution(chat.messages[0].id, restart=True)
    fresh = await agent.prepare_execution_scope()
    with pytest.raises(BadDataException, match="canceled or replaced"):
        await reader.read_for_model(old, fid, supports_vision=False)
    assert (await reader.read_for_model(fresh, fid, supports_vision=False)).text == "Private data"


@pytest.mark.asyncio
async def test_inline_attachment_revocation_blocks_provider_call(context_runtime, monkeypatch, tmp_path):
    from asterism.domains.chat.models import ChatFileModel
    from asterism.domains.chat.orchestrator import ChatOrchestrator

    r = context_runtime
    monkeypatch.setattr(config, "storage_root", tmp_path)
    fid = await add_file(r, project=False)
    await store_file(r, fid)
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
    chat = Chat.model_validate(response.json())
    agent = Agent(profile=r.profile, user=r.user, session=chat, model_id=uuid.UUID(int=2))
    await agent.prepare_execution(chat.messages[0].id)
    await agent.prepare_execution_scope()
    messages = await ChatOrchestrator(agent)._build_agent_messages()
    client = SimpleNamespace(chat=AsyncMock())
    monkeypatch.setattr(agent, "_get_client", AsyncMock(return_value=client))
    async with r.sessions() as db:
        await db.execute(delete(ChatFileModel).where(ChatFileModel.chat_id == chat.info.id))
        await db.commit()
    with pytest.raises(BadDataException, match="revoked"):
        _ = [event async for event in agent.run(messages)]
    client.chat.assert_not_called()


@pytest.mark.asyncio
async def test_obsolete_agent_assignment_api_schema_and_runtime_fields_are_absent(context_runtime):
    from asterism.db.model_registry import Base
    from asterism.domains.agent.schemas import AgentProfile, MainAgentConfiguration, SubAgentDefinition
    from asterism.main import app

    r = context_runtime
    assert "agent_knowledge_base_assignments" not in Base.metadata.tables
    assert not any("knowledge-bases" in path for path in app.openapi()["paths"] if path.startswith("/agents/"))
    for schema in [AgentProfile, MainAgentConfiguration, SubAgentDefinition]:
        assert "knowledge_bases" not in schema.model_fields
    assert (
        await r.client.put(f"/agents/{r.profile.id}/knowledge-bases", headers=auth(), json={"knowledge_base_ids": []})
    ).status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("delegated", [False, True])
async def test_runtime_tool_injects_shared_retrieval_for_main_and_delegate(context_runtime, delegated, monkeypatch):
    from asterism.domains.agent.approval import ToolUseAuthorization
    from asterism.domains.llm.schemas import Function, ToolCall

    r = context_runtime
    fid = await add_file(r)
    scope, ceiling = await execution(r)
    profile = r.profile
    if delegated:
        profile = await get_agent_profile("a", uuid.UUID(r.a["id"]))
        scope = scope.narrow_for_sub_agent(
            agent_id=profile.id,
            executed_model=ModelIdentity(id=profile.model_id),
            configuration_revision=profile.config_revision,
            effective_internal_tools=frozenset({"search_knowledge"}),
        )
        ceiling = replace(ceiling, caller_agent_id=profile.id, model_id=profile.model_id)
    root = create_retrieval_service(ceiling=ceiling)
    service = RetrievalService(
        read_scope=root.read_scope,
        embeddings=SimpleNamespace(embed_text=AsyncMock(return_value=[[0.1]])),
        vectors=SimpleNamespace(search=AsyncMock(return_value=[match(fid)])),
        limits=root.limits,
    )
    agent = Agent(
        profile=profile,
        user=r.user,
        session=r.chat,
        model_id=None if delegated else uuid.UUID(int=2),
        execution_scope=scope,
        tool_scope=ceiling,
        retrieval_service=service,
    )
    monkeypatch.setattr(agent, "_get_client", AsyncMock(return_value=SimpleNamespace()))
    results = [
        result
        async for result in agent._run_tools(
            user_message="facts",
            auths=[
                ToolUseAuthorization(
                    accept=True,
                    tool=ToolCall(
                        id="retrieve", function=Function(name="search_knowledge", arguments='{"query":"facts"}')
                    ),
                )
            ],
        )
    ]
    assert len(results) == 1
    assert results[0].raw_result["results"][0]["file_id"] == str(fid)
    assert results[0].raw_result["scope"]["agent_id"] == str(profile.id)
    service.vectors.search.assert_awaited_once()


@pytest.mark.asyncio
async def test_tool_adapter_rejects_mismatched_authenticated_user_or_chat(context_runtime):
    from asterism.core.schemas import AuthedUser
    from asterism.domains.chat.schemas import ChatInfo
    from asterism.domains.tools.builtin.search_knowledge import search_knowledge
    from test_context_tools import ctx

    r = context_runtime
    await add_file(r)
    _, ceiling = await execution(r)
    request = ctx(r, ceiling)
    wrong_user = AuthedUser(id="b", email="b@x.test", name="B", role="user")
    wrong_chat = Chat(info=ChatInfo(id=uuid.uuid4(), user_id="a", created_at=0, updated_at=0), messages=[])
    for mismatched in [replace(request, user=wrong_user), replace(request, session=wrong_chat)]:
        with pytest.raises(BadDataException, match="identity"):
            await search_knowledge(mismatched)
