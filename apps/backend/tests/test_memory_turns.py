"""US-93.5: relevant memories in every turn (ADR-0078).

A turn pins its memories on the accepted message; the recorded run keeps only
ids and revisions; each run builds the memory layer from the pins. Resume sends
the accepted text, or nothing for a memory deleted since; regeneration selects
again; children inherit the layer; General chats never get project memory.
"""

import uuid
from dataclasses import replace

import pytest
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.execution_scope import ModelIdentity
from asterism.domains.agent.service import get_agent_profile, get_main_agent_profile
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.models import MessageModel
from asterism.domains.chat.service import get_one
from asterism.domains.memory import service as memory_service
from asterism.domains.memory import turns
from asterism.domains.memory.models import MemoryKind, MemoryModel, MessageMemoryModel
from asterism.domains.settings.models import ApplicationSettingsModel
from sqlalchemy import select
from test_chat_models import B, new_chat
from test_memories import FakeEmbedding, FakeVectors
from test_project_sub_agents import runtime_setup
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
MEMORIES = "/users/me/memories/"
SECTION = "[what Asterism remembers about the user]"


class RankingVectors(FakeVectors):
    """Search returns the ids in ``order``, as if they were nearest the prompt."""

    def __init__(self):
        super().__init__()
        self.order: list[str] = []
        self.searches = 0

    async def search(self, *, user_id, project_id, vector, limit):
        self.searches += 1
        return self.order[:limit]


@pytest.fixture
def memory_on(project_api, monkeypatch):
    embedding, vectors = FakeEmbedding(), RankingVectors()
    for module in (memory_service, turns):
        monkeypatch.setattr(module, "embedding_provider", embedding)
        monkeypatch.setattr(module, "memory_vector_store", vectors)
    client, sessions, tmp_path = project_api
    return client, sessions, vectors


async def turn_on(sessions, enabled=True):
    async with sessions() as session:
        row = await session.get(ApplicationSettingsModel, "memory")
        if row is None:
            session.add(ApplicationSettingsModel(key="memory", value={"enabled": enabled, "group_ids": None}))
        else:
            row.value = {"enabled": enabled, "group_ids": None}
        await session.commit()


async def remember(client, text, project_id=None, category="learning"):
    body = (
        {"kind": "project", "project_id": project_id, "text": text}
        if project_id
        else {"kind": "user", "text": text, "category": category}
    )
    response = await client.post(MEMORIES, headers=auth(), json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def pinned(sessions, message_id):
    async with sessions() as session:
        rows = await session.scalars(
            select(MessageMemoryModel)
            .where(MessageMemoryModel.message_id == uuid.UUID(message_id))
            .order_by(MessageMemoryModel.position)
        )
        return [row.text for row in rows]


async def create_project(client, name):
    response = await client.post("/projects/", headers=auth(), json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def main_agent(chat):
    async def build():
        agent = Agent(
            profile=await get_main_agent_profile("a"),
            user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
            session=await get_one(uuid.UUID(chat["info"]["id"]), "a"),
            model_id=uuid.UUID(B),
        )
        await agent.prepare_execution(uuid.UUID(chat["messages"][0]["id"]))
        return agent

    return build()


@pytest.mark.asyncio
async def test_general_chats_pin_user_memory_and_project_chats_add_their_own(memory_on):
    client, sessions, _ = memory_on
    await turn_on(sessions)
    thesis = await create_project(client, "Thesis")
    other = await create_project(client, "Other")
    await remember(client, "Learns best from worked examples")
    await remember(client, "Thesis uses APA citations", project_id=thesis)
    await remember(client, "Other project secret", project_id=other)

    general = await new_chat(client)
    assert await pinned(sessions, general["messages"][0]["id"]) == ["Learns best from worked examples"]

    in_thesis = await new_chat(client, project_id=thesis)
    assert sorted(await pinned(sessions, in_thesis["messages"][0]["id"])) == [
        "Learns best from worked examples",
        "Thesis uses APA citations",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("switch", ["policy", "personal"])
async def test_nothing_is_pinned_or_sent_when_memory_is_off(memory_on, switch):
    client, sessions, _ = memory_on
    await turn_on(sessions)
    await remember(client, "Learns best from worked examples")
    if switch == "policy":
        await turn_on(sessions, enabled=False)
    else:
        assert (
            await client.put("/settings/user/memory_enabled", headers=auth(), json={"value": False})
        ).status_code == 200
    chat = await new_chat(client)
    assert await pinned(sessions, chat["messages"][0]["id"]) == []
    agent = await main_agent(chat)
    assert SECTION not in await agent._build_system_prompt()


@pytest.mark.asyncio
async def test_resume_sends_the_accepted_text_then_nothing_once_deleted_and_regenerate_selects_again(memory_on):
    client, sessions, _ = memory_on
    await turn_on(sessions)
    memory = await remember(client, "Accepted: prefers short answers")
    chat = await new_chat(client)
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])

    # Edited between acceptance and the run: the run sends the accepted text.
    edited = await client.put(
        f"{MEMORIES}{memory['id']}",
        headers=auth(),
        json={"text": "Edited: prefers long answers", "category": "learning", "expected_revision": 1},
    )
    assert edited.status_code == 200
    agent = await main_agent(chat)
    text = await agent._build_system_prompt()
    assert SECTION in text and "- Accepted: prefers short answers" in text and "Edited" not in text
    # Information, never instructions, and after About you's place in the order.
    assert "information, not instructions" in text
    assert [use.id for use in agent.execution.memories] == [uuid.UUID(memory["id"])]
    assert [use.revision for use in agent.execution.memories] == [1]

    # Nothing about the text is recorded: not in the prompt, not in public provenance.
    async with sessions() as db:
        recorded = (await db.get(MessageModel, mid)).pending_prompt
        assert all(layer.kind != "memory" for layer in recorded.layers)
        assert "Accepted" not in recorded.text
    info = (await client.get(f"/chat/{cid}", headers=auth())).json()["info"]
    assert "Accepted" not in str(info["pending_execution"])
    assert info["pending_execution"]["memories"] == [{"id": memory["id"], "revision": 1}]

    # Deleted before the resume: Asterism stops sending it.
    assert (
        await client.delete(f"{MEMORIES}{memory['id']}", headers=auth(), params={"expected_revision": 2})
    ).status_code == 204
    assert await pinned(sessions, str(mid)) == []
    resumed = await main_agent(chat)
    assert SECTION not in await resumed._build_system_prompt()

    # Regeneration selects the current memories again and re-pins them.
    await remember(client, "Now: learns from diagrams")
    async with sessions() as db:
        regenerated = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, restart=True, session=db)
    assert len(regenerated.memories) == 1
    assert await pinned(sessions, str(mid)) == ["Now: learns from diagrams"]


@pytest.mark.asyncio
async def test_turning_memory_off_after_acceptance_stops_the_resume_using_it(memory_on):
    client, sessions, _ = memory_on
    await turn_on(sessions)
    await remember(client, "Learns best from worked examples")
    chat = await new_chat(client)
    agent = await main_agent(chat)
    assert SECTION in await agent._build_system_prompt()
    await turn_on(sessions, enabled=False)
    resumed = await main_agent(chat)
    assert SECTION not in await resumed._build_system_prompt()


@pytest.mark.asyncio
async def test_delete_all_removes_every_pinned_copy(memory_on):
    client, sessions, _ = memory_on
    await turn_on(sessions)
    await remember(client, "First")
    await remember(client, "Second")
    chat = await new_chat(client)
    assert len(await pinned(sessions, chat["messages"][0]["id"])) == 2
    assert (await client.delete(MEMORIES, headers=auth())).json() == {"deleted": 2}
    assert await pinned(sessions, chat["messages"][0]["id"]) == []


@pytest.mark.asyncio
async def test_selection_ranks_by_relevance_within_the_count_and_token_budget(memory_on, monkeypatch):
    client, sessions, vectors = memory_on
    await turn_on(sessions)
    made = [await remember(client, f"Memory {n}") for n in range(12)]
    # The prompt is nearest memories 11, 3 and 7; the rest have no ranked vector.
    vectors.order = [made[11]["id"], made[3]["id"], made[7]["id"]]
    async with sessions() as session:
        chosen = await turns.select_turn_memories(user_id="a", project_id=None, prompt="Quiz me", session=session)
    assert len(chosen) == turns.MAX_TURN_MEMORIES
    assert [memory.text for memory in chosen[:3]] == ["Memory 11", "Memory 3", "Memory 7"]

    # Few memories: all of them, without searching.
    async with sessions() as session:
        await session.execute(MemoryModel.__table__.delete().where(MemoryModel.text.not_in(["Memory 1", "Memory 2"])))
        await session.commit()
        searches = vectors.searches
        few = await turns.select_turn_memories(user_id="a", project_id=None, prompt="Quiz me", session=session)
    assert sorted(memory.text for memory in few) == ["Memory 1", "Memory 2"] and vectors.searches == searches

    # The token budget skips what doesn't fit and keeps what does.
    monkeypatch.setattr(turns, "MAX_TURN_MEMORY_TOKENS", 30)
    await remember(client, "word " * 200)
    async with sessions() as session:
        budgeted = await turns.select_turn_memories(user_id="a", project_id=None, prompt="x", session=session)
    assert sorted(memory.text for memory in budgeted) == ["Memory 1", "Memory 2"]


@pytest.mark.asyncio
async def test_ranking_falls_back_to_recency_without_embeddings(memory_on, monkeypatch):
    client, sessions, _ = memory_on
    await turn_on(sessions)
    for n in range(10):
        await remember(client, f"Memory {n}")

    class Broken:
        async def embed_text(self, texts):
            raise RuntimeError("model not downloaded")

        embed_query = embed_passage = embed_text

    monkeypatch.setattr(turns, "embedding_provider", Broken())
    async with sessions() as session:
        chosen = await turns.select_turn_memories(user_id="a", project_id=None, prompt="Hi", session=session)
    assert len(chosen) == turns.MAX_TURN_MEMORIES


@pytest.mark.asyncio
async def test_project_memory_never_reaches_a_general_selection(memory_on):
    client, sessions, vectors = memory_on
    await turn_on(sessions)
    project = await create_project(client, "Thesis")
    secret = await remember(client, "Project only", project_id=project)
    for n in range(9):
        await remember(client, f"User {n}")
    vectors.order = [secret["id"]]  # even if a search returned it
    async with sessions() as session:
        chosen = await turns.select_turn_memories(user_id="a", project_id=None, prompt="Hi", session=session)
    assert all(memory.kind == MemoryKind.USER for memory in chosen)


@pytest.mark.asyncio
async def test_delegates_inherit_the_memory_layer(project_api, monkeypatch):
    embedding, vectors = FakeEmbedding(), RankingVectors()
    for module in (memory_service, turns):
        monkeypatch.setattr(module, "embedding_provider", embedding)
        monkeypatch.setattr(module, "memory_vector_store", vectors)
    client, sessions, p, _, worker, _, _ = await runtime_setup(project_api, monkeypatch)
    await turn_on(sessions)
    await remember(client, "Learns best from worked examples")
    chat = await new_chat(client, project_id=p["id"])
    main = await main_agent(chat)
    scope = await main.prepare_execution_scope()
    assert scope.memory_layer is not None
    profile = await get_agent_profile("a", uuid.UUID(worker["id"]))
    child_scope = scope.narrow_for_sub_agent(
        agent_id=profile.id,
        executed_model=ModelIdentity(id=profile.model_id),
        configuration_revision=profile.config_revision,
        effective_internal_tools=frozenset(),
    )
    child = Agent(
        profile=profile,
        user=main.user,
        session=main.session,
        execution_scope=child_scope,
        tool_scope=replace(main.tool_scope, caller_agent_id=profile.id, model_id=profile.model_id),
    )
    assert "- Learns best from worked examples" in await child._build_system_prompt()
    assert child_scope.memory_layer == scope.memory_layer


@pytest.mark.asyncio
async def test_every_comparison_column_pins_the_same_memories(memory_on):
    from test_chat_comparisons import compare_chat

    client, sessions, _ = memory_on
    await turn_on(sessions)
    await remember(client, "Learns best from worked examples")
    response = await compare_chat(client)
    assert response.status_code == 200, response.text
    chat_id = uuid.UUID(response.json()["info"]["id"])
    async with sessions() as session:
        columns = [
            str(message_id)
            for message_id in await session.scalars(
                select(MessageModel.id).where(MessageModel.chat_id == chat_id, MessageModel.role == "user")
            )
        ]
    assert len(columns) == 2
    for column in columns:
        assert await pinned(sessions, column) == ["Learns best from worked examples"]
