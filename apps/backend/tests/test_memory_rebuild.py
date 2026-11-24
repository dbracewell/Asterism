"""US-93.6: memory vectors are rebuilt from the memory rows, never the reverse."""

import uuid

import pytest
from asterism.domains.memory import service as memory_service
from asterism.domains.memory.models import MemoryCategory, MemoryKind, MemoryModel
from asterism.domains.memory.rebuild import rebuild_memory_vectors
from asterism.domains.memory.vectors import LanceDbMemoryVectorStore, MemoryVector
from asterism.domains.user.models import UserModel
from test_memories import DIMENSION, FakeEmbedding
from test_projects_api import project_api as _project_api

project_api = _project_api


def vector(memory_id, user_id="a", revision=1):
    return MemoryVector(
        memory_id=str(memory_id), user_id=user_id, kind="user", project_id="", revision=revision, vector=[1.0, 0, 0, 0]
    )


@pytest.fixture
def rebuild(project_api, monkeypatch, tmp_path):
    _, sessions, _ = project_api
    embedding = FakeEmbedding()
    store = LanceDbMemoryVectorStore(tmp_path / "memory-lancedb", dimension=DIMENSION, model_key="test")
    monkeypatch.setattr(memory_service, "embedding_provider", embedding)
    monkeypatch.setattr(memory_service, "memory_vector_store", store)
    return sessions, embedding, store


async def add(sessions, user_id, text, revision=1):
    async with sessions() as session:
        if await session.get(UserModel, user_id) is None:
            session.add(UserModel(id=user_id, name=user_id))
        row = MemoryModel(
            user_id=user_id, kind=MemoryKind.USER, text=text, category=MemoryCategory.OTHER, revision=revision
        )
        session.add(row)
        await session.commit()
        return row.id


@pytest.mark.asyncio
async def test_missing_and_stale_vectors_are_rebuilt_and_leftovers_removed(rebuild):
    sessions, embedding, store = rebuild
    current = await add(sessions, "a", "Current")
    stale = await add(sessions, "a", "Edited since", revision=2)
    missing = await add(sessions, "b", "Never embedded")
    gone = uuid.uuid4()
    await store.write(vector(current))
    await store.write(vector(stale, revision=1))
    await store.write(vector(gone))
    await store.write(vector("left-by-a-deleted-account", user_id="z"))

    async with sessions() as session:
        result = await rebuild_memory_vectors(session)
    assert (result.rebuilt, result.failed, result.removed) == (2, 0, 2)
    assert sorted(embedding.texts) == ["Edited since", "Never embedded"]
    assert await store.list_revisions(user_id="a") == {str(current): 1, str(stale): 2}
    assert await store.list_revisions(user_id="b") == {str(missing): 1}
    assert await store.list_owners() == {"a", "b"}

    # Nothing to do the second time.
    async with sessions() as session:
        again = await rebuild_memory_vectors(session)
    assert (again.rebuilt, again.failed, again.removed) == (0, 0, 0)


@pytest.mark.asyncio
async def test_a_model_that_is_not_ready_stops_the_rebuild_until_the_next_start(rebuild):
    sessions, embedding, store = rebuild
    await add(sessions, "a", "First")
    await add(sessions, "a", "Second")
    embedding.fail = True
    async with sessions() as session:
        result = await rebuild_memory_vectors(session)
    assert (result.rebuilt, result.failed) == (0, 2)
    assert await store.list_revisions(user_id="a") == {}

    embedding.fail = False
    async with sessions() as session:
        result = await rebuild_memory_vectors(session)
    assert result.rebuilt == 2
