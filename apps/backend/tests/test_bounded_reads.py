"""US-121.3: vector lookups use bounded file lists, and parallel tool calls share one model lookup."""

import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import ToolUseAuthorization
from asterism.domains.agent.service import get_main_agent_profile
from asterism.domains.chat.schemas import Chat, ChatInfo
from asterism.domains.knowledge import vector_store
from asterism.domains.knowledge.vector_store import LanceDbVectorStore, VectorChunk
from asterism.domains.llm.schemas import ToolCall
from asterism.domains.memory import vectors as memory_vectors
from asterism.domains.memory.vectors import LanceDbMemoryVectorStore, MemoryVector
from test_main_agent_defaults import main_agent_session as _main_agent_session

main_agent_session = _main_agent_session
pytestmark = pytest.mark.asyncio

FILES = 1200


async def test_search_over_many_files_splits_the_filter_and_keeps_the_nearest(tmp_path: Path, monkeypatch):
    store = LanceDbVectorStore(tmp_path / "vectors", dimension=2, model_key="test", max_concurrency=1)
    # File n's chunk points further from the query as n grows, so file 0 is nearest.
    await store.add(
        [
            VectorChunk(f"c{n}", "user-a", f"file-{n}", 1, 0, "text", f"passage {n}", [1.0, n / FILES])
            for n in range(FILES)
        ]
        + [VectorChunk("theirs", "user-b", "file-0", 1, 0, "text", "other user", [1.0, 0.0])]
    )
    filters: list[str] = []
    real_search = LanceDbVectorStore._require_table

    def watching_table(self):
        table = real_search(self)

        class Watched:
            def search(self, *args):
                query = table.search(*args)
                real_where = query.where

                def where(predicate, **kwargs):
                    filters.append(predicate)
                    return real_where(predicate, **kwargs)

                query.where = where
                return query

        return Watched()

    monkeypatch.setattr(LanceDbVectorStore, "_require_table", watching_table)
    # Newest files first in the allowed list, so the nearest chunk is in the last batch.
    allowed = [f"file-{n}" for n in reversed(range(FILES))] + ["file-0"]
    results = await store.search([1.0, 0.0], user_id="user-a", allowed_file_ids=allowed, limit=3)

    assert [result.file_id for result in results] == ["file-0", "file-1", "file-2"]
    assert {result.user_id for result in results} == {"user-a"}
    assert len(filters) == -(-FILES // vector_store.FILE_BATCH)
    assert max(predicate.count("'file-") for predicate in filters) == vector_store.FILE_BATCH
    await store.close()


async def test_deleting_many_memory_vectors_splits_the_filter(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(memory_vectors, "MEMORY_BATCH", 2)
    store = LanceDbMemoryVectorStore(tmp_path / "memory", dimension=2, model_key="test")
    ids = [str(uuid.UUID(int=n)) for n in range(5)]
    for memory_id in ids:
        await store.write(MemoryVector(memory_id, "user-a", "user", "", 1, [1.0, 0.0]))
    await store.write(MemoryVector(ids[0], "user-b", "user", "", 1, [1.0, 0.0]))

    await store.delete_memories(user_id="user-a", memory_ids=ids[:4])

    assert await store.list_revisions(user_id="user-a") == {ids[4]: 1}
    assert await store.list_revisions(user_id="user-b") == {ids[0]: 1}


async def test_parallel_tool_calls_share_one_model_lookup(main_agent_session, monkeypatch):
    profile = await get_main_agent_profile("user-a", main_agent_session)
    agent = Agent(
        profile=profile,
        user=AuthedUser(id="user-a", name="A", email="a@example.test", role="user"),
        session=Chat(info=ChatInfo(id=uuid.uuid4(), user_id="user-a", created_at=0, updated_at=0), messages=[]),
    )
    client = object()
    lookup = AsyncMock(return_value=client)
    monkeypatch.setattr(agent, "_get_client", lookup)
    monkeypatch.setattr(agent, "resolve_tools", AsyncMock(return_value=["web_fetch"]))
    invoke = AsyncMock(return_value=SimpleNamespace(content="ok"))
    monkeypatch.setattr("asterism.domains.tools.registry.tool_registry.invoke_tool", invoke)
    monkeypatch.setattr(
        "asterism.domains.settings.service.get_app_settings",
        AsyncMock(return_value=SimpleNamespace(active_tools=["web_fetch"])),
    )

    def call(n: int) -> ToolUseAuthorization:
        tool = ToolCall.model_validate(
            {"id": f"call-{n}", "type": "function", "function": {"name": "web_fetch", "arguments": "{}"}}
        )
        return ToolUseAuthorization(tool=tool, accept=True)

    results = [result async for result in agent._run_tools("", [call(n) for n in range(4)])]

    assert len(results) == 4 and invoke.await_count == 4
    lookup.assert_awaited_once()
    assert {kwargs["client"] for _, kwargs in invoke.await_args_list} == {client}

    # Nothing accepted: no model lookup at all.
    lookup.reset_mock()
    refused = ToolUseAuthorization(tool=call(9).tool, accept=False)
    assert len([result async for result in agent._run_tools("", [refused])]) == 1
    lookup.assert_not_awaited()
