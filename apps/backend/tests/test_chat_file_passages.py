"""US-90.4: the source page reads one cited passage of a file in the chat's live scope."""

import pytest
from asterism.core import config
from asterism.domains.knowledge import vector_store as vector_module
from asterism.domains.knowledge.vector_store import LanceDbVectorStore, VectorChunk
from test_chat_file_scope import chat, seed_agent, upload
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api


def chunk(chunk_id, user, file_id, ordinal, content, *, kind="text", generation=1):
    return VectorChunk(chunk_id, user, file_id, generation, ordinal, kind, content, [1.0, 0.0])


@pytest.mark.asyncio
async def test_store_reads_one_owned_chunk_and_counts_its_generation(tmp_path):
    store = LanceDbVectorStore(tmp_path / "vectors", dimension=2, model_key="test", max_concurrency=1)
    await store.add(
        [
            chunk("c0", "a", "f", 0, "first", generation=2),
            chunk("c1", "a", "f", 1, "second", generation=2),
            chunk("old", "a", "f", 0, "stale"),
            chunk("theirs", "b", "f", 0, "other user"),
        ]
    )
    found = await store.get_chunk(user_id="a", file_id="f", chunk_id="c1")
    assert found is not None and (found.content, found.chunk_ordinal, found.kind) == ("second", 1, "text")
    assert await store.get_chunk(user_id="a", file_id="f", chunk_id="theirs") is None
    assert await store.get_chunk(user_id="a", file_id="other", chunk_id="c1") is None
    assert await store.count_file_chunks(user_id="a", file_id="f", artifact_generation=2) == 2


@pytest.mark.asyncio
async def test_passage_route_checks_chat_scope_and_reports_its_place(project_api, monkeypatch, tmp_path):
    client, sessions, storage = project_api
    monkeypatch.setattr(config, "storage_root", storage)
    store = LanceDbVectorStore(tmp_path / "vectors", dimension=2, model_key="test", max_concurrency=1)
    monkeypatch.setattr(vector_module, "vector_store", store)
    agent = await seed_agent(sessions)
    cited, outside = await upload(client, "notes.txt"), await upload(client, "elsewhere.txt")
    record = await chat(client, agent, [cited["id"]])
    await store.add(
        [
            chunk("p0", "a", cited["id"], 0, "Opening."),
            chunk("p1", "a", cited["id"], 1, "RuBisCO joins carbon dioxide to RuBP."),
            chunk("p2", "a", cited["id"], 2, "Closing.", kind="caption"),
            chunk("q0", "a", outside["id"], 0, "Not in this chat."),
        ]
    )
    base = f"/chat/{record['info']['id']}/files"

    response = await client.get(f"{base}/{cited['id']}/passages/p1", headers=auth())
    assert response.status_code == 200, response.text
    assert response.json() == {
        "chunk_id": "p1",
        "kind": "text",
        "position": 2,
        "total": 3,
        "text": "RuBisCO joins carbon dioxide to RuBP.",
    }
    assert (await client.get(f"{base}/{cited['id']}/passages/p2", headers=auth())).json()["kind"] == "caption"

    # A file outside the chat's scope, another user, and no token are all refused.
    assert (await client.get(f"{base}/{outside['id']}/passages/q0", headers=auth())).status_code == 404
    assert (await client.get(f"{base}/{cited['id']}/passages/p1", headers=auth("b"))).status_code == 404
    assert (await client.get(f"{base}/{cited['id']}/passages/p1")).status_code == 401
    # A chunk of another scoped file can't be read through this file's address.
    assert (await client.get(f"{base}/{cited['id']}/passages/q0", headers=auth())).status_code == 404

    # Re-processed since: the passage is gone, and the page is told so plainly.
    gone = await client.get(f"{base}/{cited['id']}/passages/missing", headers=auth())
    assert gone.status_code == 404
    assert gone.json()["detail"] == "This passage is no longer in the file. It may have been updated since."
