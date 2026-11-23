"""US-93.1: the memory store and its boundary (ADR-0078).

Ownership, the user/project rules, caps, revisions, deletion and the memory
vector table. Embedding and the vector table are doubles in the API tests and
the real LanceDB table in the store tests.
"""

import uuid

import pytest
from asterism.domains.chat.models import ChatModel
from asterism.domains.memory import service as memory_service
from asterism.domains.memory import vectors as memory_vectors
from asterism.domains.memory.models import MemoryKind, MemoryModel, MemorySavedBy
from asterism.domains.memory.vectors import LanceDbMemoryVectorStore, MemoryVector
from asterism.domains.user.models import UserModel
from sqlalchemy import delete, func, select
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
BASE = "/users/me/memories/"
DIMENSION = 4


class FakeEmbedding:
    def __init__(self):
        self.texts: list[str] = []
        self.fail = False

    async def embed_text(self, texts):
        if self.fail:
            raise RuntimeError("model not ready")
        self.texts.extend(texts)
        return [[1.0, 0.0, 0.0, 0.0] for _ in texts]


class FakeVectors:
    def __init__(self):
        self.rows: dict[str, MemoryVector] = {}
        self.deleted_users: list[str] = []
        self.deleted_projects: list[tuple[str, uuid.UUID]] = []

    async def write(self, row):
        self.rows[row.memory_id] = row

    async def delete_memories(self, *, user_id, memory_ids):
        for memory_id in memory_ids:
            row = self.rows.get(str(memory_id))
            if row and row.user_id == user_id:
                del self.rows[str(memory_id)]

    async def delete_project(self, *, user_id, project_id):
        self.deleted_projects.append((user_id, project_id))
        for key, row in list(self.rows.items()):
            if row.user_id == user_id and row.project_id == str(project_id):
                del self.rows[key]

    async def delete_user(self, *, user_id):
        self.deleted_users.append(user_id)
        self.rows = {key: row for key, row in self.rows.items() if row.user_id != user_id}


@pytest.fixture
def memory_api(project_api, monkeypatch):
    embedding, vectors = FakeEmbedding(), FakeVectors()
    monkeypatch.setattr(memory_service, "embedding_provider", embedding)
    monkeypatch.setattr(memory_service, "memory_vector_store", vectors)
    # Account deletion imports the store from its own module.
    monkeypatch.setattr(memory_vectors, "memory_vector_store", vectors)
    client, sessions, tmp_path = project_api
    return client, sessions, embedding, vectors


def user_memory(**fields):
    return {"kind": "user", "text": "Learns best from worked examples", "category": "learning", **fields}


async def create(client, user="a", **fields):
    response = await client.post(BASE, headers=auth(user), json=user_memory(**fields))
    assert response.status_code == 201, response.text
    return response.json()


async def create_project(client, user="a", name=None):
    name = name or f"Project {uuid.uuid4().hex[:8]}"
    response = await client.post("/projects/", headers=auth(user), json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_crud_roundtrip_with_revisions_and_vectors(memory_api):
    client, _, embedding, vectors = memory_api
    memory = await create(client, text="  Prefers short answers  ")
    assert memory["text"] == "Prefers short answers"  # trimmed
    assert memory | {"id": None, "created_at": None, "updated_at": None} == {
        "id": None,
        "kind": "user",
        "project_id": None,
        "text": "Prefers short answers",
        "category": "learning",
        "sensitive": False,
        "saved_by": "person",
        "source": {"chat_id": None, "message_id": None, "execution_id": None, "chat_deleted": False},
        "revision": 1,
        "created_at": None,
        "updated_at": None,
    }
    assert vectors.rows[memory["id"]].revision == 1 and vectors.rows[memory["id"]].user_id == "a"

    path = f"{BASE}{memory['id']}"
    assert (await client.get(path, headers=auth())).json() == memory
    updated = await client.put(
        path,
        headers=auth(),
        json={"text": "Prefers worked examples", "category": "learning", "expected_revision": 1},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["revision"] == 2 and updated.json()["text"] == "Prefers worked examples"
    # The vector is rewritten on edit, one row per memory.
    assert vectors.rows[memory["id"]].revision == 2 and len(vectors.rows) == 1
    assert embedding.texts == ["Prefers short answers", "Prefers worked examples"]

    stale = await client.put(
        path, headers=auth(), json={"text": "Lost edit", "category": "learning", "expected_revision": 1}
    )
    assert stale.status_code == 409
    assert (await client.delete(path, headers=auth(), params={"expected_revision": 1})).status_code == 409
    assert (await client.delete(path, headers=auth(), params={"expected_revision": 2})).status_code == 204
    assert (await client.get(path, headers=auth())).status_code == 404
    assert vectors.rows == {}


@pytest.mark.asyncio
async def test_only_the_owner_sees_a_memory_and_foreign_ids_look_missing(memory_api):
    client, _, _, _ = memory_api
    memory = await create(client, user="a")
    path = f"{BASE}{memory['id']}"
    missing = f"{BASE}{uuid.uuid4()}"
    for target in (path, missing):
        responses = [
            await client.get(target, headers=auth("b")),
            await client.put(
                target, headers=auth("b"), json={"text": "Mine", "category": "other", "expected_revision": 1}
            ),
            await client.delete(target, headers=auth("b"), params={"expected_revision": 1}),
        ]
        assert [r.status_code for r in responses] == [404, 404, 404]
        assert {r.json()["detail"] for r in responses} == {"Memory not found"}
    assert (await client.get(BASE, headers=auth("b"))).json()["total"] == 0
    assert (await client.delete(BASE, headers=auth("b"))).json() == {"deleted": 0}
    assert (await client.get(path, headers=auth("a"))).status_code == 200
    assert (await client.get(BASE)).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fields",
    [
        {"category": None},  # a user memory needs a category
        {"project_id": str(uuid.uuid4())},  # and belongs to no project
        {"kind": "project", "category": None},  # a project memory needs a project
        {"text": "   "},
        {"text": "x" * 2001},
        {"text": "é" * 1999 + "\U0001f600" * 1},  # fine: 2,000 characters, under 8,000 bytes
        {"text": "bell\x07"},
        {"owner": "b"},  # clients never write the owner
        {"revision": 9},
    ],
)
async def test_validation(memory_api, fields):
    client, _, _, _ = memory_api
    response = await client.post(BASE, headers=auth(), json=user_memory(**fields))
    expected = 201 if fields.get("text", "").startswith("é") else 422
    assert response.status_code == expected, response.text


@pytest.mark.asyncio
async def test_accessibility_memories_are_always_sensitive(memory_api):
    client, _, _, _ = memory_api
    memory = await create(client, text="Uses a screen reader", category="accessibility", sensitive=False)
    assert memory["sensitive"] is True
    other = await create(client, text="Grew up bilingual", category="background", sensitive=True)
    assert other["sensitive"] is True
    plain = await create(client, text="Studies in the evening", category="other")
    assert plain["sensitive"] is False
    edited = await client.put(
        f"{BASE}{plain['id']}",
        headers=auth(),
        json={"text": "Has dyslexia", "category": "accessibility", "sensitive": False, "expected_revision": 1},
    )
    assert edited.json()["sensitive"] is True


@pytest.mark.asyncio
async def test_project_memory_belongs_to_the_owners_project(memory_api):
    client, _, _, vectors = memory_api
    project = await create_project(client, user="a")
    foreign = await create_project(client, user="b")
    memory = await create(client, kind="project", project_id=project["id"], category=None, text="APA citations")
    assert memory["project_id"] == project["id"] and memory["category"] is None
    assert vectors.rows[memory["id"]].project_id == project["id"]

    for project_id in (foreign["id"], str(uuid.uuid4())):
        response = await client.post(
            BASE, headers=auth(), json={"kind": "project", "project_id": project_id, "text": "Leak"}
        )
        assert response.status_code == 404 and response.json()["detail"] == "Project not found"

    # A project memory gets no category on edit, and a user memory keeps one.
    no_category = await client.put(
        f"{BASE}{memory['id']}",
        headers=auth(),
        json={"text": "MLA citations", "category": "learning", "expected_revision": 1},
    )
    assert no_category.status_code == 400
    user = await create(client)
    needs_category = await client.put(
        f"{BASE}{user['id']}", headers=auth(), json={"text": "Edited", "expected_revision": 1}
    )
    assert needs_category.status_code == 400


@pytest.mark.asyncio
async def test_listing_filters_and_orders_deterministically(memory_api):
    client, sessions, _, _ = memory_api
    project = await create_project(client)
    made = [await create(client, text=f"User {n}") for n in range(3)]
    in_project = await create(client, kind="project", project_id=project["id"], category=None, text="Project")
    await create(client, user="b", text="Someone else")
    # Same timestamp for all: the id breaks the tie, so pages never overlap.
    async with sessions() as session:
        await session.execute(MemoryModel.__table__.update().values(updated_at=100))
        await session.commit()

    everything = (await client.get(BASE, headers=auth(), params={"page_size": 100})).json()
    assert everything["total"] == 4
    ids = [item["id"] for item in everything["items"]]
    assert ids == sorted(ids, key=lambda value: uuid.UUID(value).hex)
    pages = [
        (await client.get(BASE, headers=auth(), params={"page": page, "page_size": 2})).json()["items"]
        for page in (1, 2)
    ]
    assert [item["id"] for page in pages for item in page] == ids

    users = (await client.get(BASE, headers=auth(), params={"kind": "user"})).json()
    assert {item["id"] for item in users["items"]} == {memory["id"] for memory in made}
    projects = (await client.get(BASE, headers=auth(), params={"project_id": project["id"]})).json()
    assert [item["id"] for item in projects["items"]] == [in_project["id"]]


@pytest.mark.asyncio
async def test_caps_per_kind_and_project(memory_api, monkeypatch):
    client, _, _, _ = memory_api
    monkeypatch.setattr(memory_service, "MAX_MEMORIES_PER_SCOPE", 2)
    project = await create_project(client)
    other = await create_project(client)
    for _ in range(2):
        await create(client)
        await create(client, kind="project", project_id=project["id"], category=None)
    over = await client.post(BASE, headers=auth(), json=user_memory())
    assert over.status_code == 409 and "200" not in over.json()["detail"]
    project_over = await client.post(
        BASE, headers=auth(), json={"kind": "project", "project_id": project["id"], "text": "Third"}
    )
    assert project_over.status_code == 409
    # Each project has its own cap, and another person has theirs.
    await create(client, kind="project", project_id=other["id"], category=None)
    await create(client, user="b")
    assert (await client.get(BASE, headers=auth())).json()["total"] == 5


@pytest.mark.asyncio
async def test_delete_all_by_kind_and_project(memory_api):
    client, _, _, vectors = memory_api
    project = await create_project(client)
    await create(client)
    await create(client)
    await create(client, kind="project", project_id=project["id"], category=None)
    kept = await create(client, user="b")
    assert (await client.delete(BASE, headers=auth(), params={"project_id": project["id"]})).json() == {"deleted": 1}
    assert (await client.delete(BASE, headers=auth(), params={"kind": "user"})).json() == {"deleted": 2}
    assert (await client.get(BASE, headers=auth())).json()["total"] == 0
    assert list(vectors.rows) == [kept["id"]]


@pytest.mark.asyncio
async def test_a_memory_is_saved_without_a_vector_when_embedding_fails(memory_api):
    client, _, embedding, vectors = memory_api
    embedding.fail = True
    memory = await create(client, text="Sensitive detail", category="accessibility")
    assert memory["revision"] == 1 and vectors.rows == {}


@pytest.mark.asyncio
async def test_project_deletion_removes_its_memories_and_keeps_user_memory(memory_api):
    client, _, _, vectors = memory_api
    project = await create_project(client)
    user = await create(client)
    await create(client, kind="project", project_id=project["id"], category=None)
    deleted = await client.delete(f"/projects/{project['id']}", headers=auth(), params={"expected_context_revision": 1})
    assert deleted.status_code == 200, deleted.text
    remaining = (await client.get(BASE, headers=auth())).json()["items"]
    assert [item["id"] for item in remaining] == [user["id"]]
    assert vectors.deleted_projects == [("a", uuid.UUID(project["id"]))]
    assert list(vectors.rows) == [user["id"]]


@pytest.mark.asyncio
async def test_chat_deletion_keeps_the_memory_and_marks_its_source(memory_api):
    client, sessions, _, _ = memory_api
    chat_id, memory_id = uuid.uuid4(), uuid.uuid4()
    async with sessions() as session:
        session.add(ChatModel(id=chat_id, user_id="a", title="Study"))
        await session.flush()
        session.add(
            MemoryModel(
                id=memory_id,
                user_id="a",
                kind=MemoryKind.USER,
                text="Learns best from diagrams",
                category="learning",
                saved_by=MemorySavedBy.AGENT,
                source_chat_id=chat_id,
            )
        )
        await session.commit()
    before = (await client.get(f"{BASE}{memory_id}", headers=auth())).json()["source"]
    assert before["chat_id"] == str(chat_id) and before["chat_deleted"] is False

    async with sessions() as session:
        await session.execute(delete(ChatModel).where(ChatModel.id == chat_id))
        await session.commit()
    after = (await client.get(f"{BASE}{memory_id}", headers=auth())).json()
    assert after["text"] == "Learns best from diagrams"
    assert after["source"] == {"chat_id": None, "message_id": None, "execution_id": None, "chat_deleted": True}


@pytest.mark.asyncio
async def test_account_deletion_removes_memories_and_vectors(memory_api):
    client, sessions, _, vectors = memory_api
    await create(client, user="b")
    kept = await create(client, user="a")
    from asterism.domains.user.service import delete_user

    async with sessions() as session:
        await delete_user("b", session=session)
    async with sessions() as session:
        owners = (await session.execute(select(MemoryModel.user_id))).scalars().all()
        assert owners == ["a"]
        assert await session.scalar(select(func.count()).select_from(UserModel).where(UserModel.id == "b")) == 0
    assert vectors.deleted_users == ["b"] and list(vectors.rows) == [kept["id"]]


# The real LanceDB table.


def vector(memory_id, user_id="a", project_id="", revision=1, value=1.0):
    return MemoryVector(
        memory_id=str(memory_id),
        user_id=user_id,
        kind=MemoryKind.PROJECT.value if project_id else MemoryKind.USER.value,
        project_id=project_id,
        revision=revision,
        vector=[value, 0.0, 0.0, 0.0],
    )


@pytest.mark.asyncio
async def test_lancedb_memory_vectors_are_one_row_per_memory_and_owner_scoped(tmp_path):
    store = LanceDbMemoryVectorStore(tmp_path / "lancedb", dimension=DIMENSION)
    first, second, project_memory, foreign = (uuid.uuid4() for _ in range(4))
    project = uuid.uuid4()
    await store.write(vector(first))
    await store.write(vector(first, revision=2))  # rewritten, not duplicated
    await store.write(vector(second))
    await store.write(vector(project_memory, project_id=str(project)))
    await store.write(vector(foreign, user_id="b"))
    assert set(await store.list_revisions(user_id="a")) == {str(first), str(second), str(project_memory)}
    rows = store._table.search().where(f"memory_id = '{first}'").to_list()
    assert [row["revision"] for row in rows] == [2]
    assert "text" not in rows[0]  # ids and scope only

    # Another owner's id is never deleted through this owner.
    await store.delete_memories(user_id="a", memory_ids=[foreign, second])
    assert set(await store.list_revisions(user_id="b")) == {str(foreign)}
    await store.delete_project(user_id="a", project_id=project)
    assert set(await store.list_revisions(user_id="a")) == {str(first)}
    await store.delete_user(user_id="a")
    assert set(await store.list_revisions(user_id="a")) == set()
    assert set(await store.list_revisions(user_id="b")) == {str(foreign)}

    with pytest.raises(ValueError):
        await store.write(MemoryVector(**{**vector(first).__dict__, "vector": [1.0]}))
    # Quotes in ids can't break the filter.
    await store.write(vector("it's", user_id="o'brien"))
    assert set(await store.list_revisions(user_id="o'brien")) == {"it's"}


@pytest.mark.asyncio
async def test_memory_text_never_reaches_the_logs(memory_api, monkeypatch):
    client, _, embedding, _ = memory_api
    lines: list[str] = []
    for level in ("info", "warning", "error", "exception", "debug"):
        monkeypatch.setattr(
            memory_service.logger, level, lambda message, *args, **kwargs: lines.append(str(message) % args)
        )
    secret = "Has epilepsy and avoids flashing images"
    memory = await create(client, text=secret, category="accessibility")
    embedding.fail = True
    await client.put(
        f"{BASE}{memory['id']}",
        headers=auth(),
        json={"text": secret + " too", "category": "accessibility", "expected_revision": 1},
    )
    await client.delete(f"{BASE}{memory['id']}", headers=auth(), params={"expected_revision": 2})
    assert lines and all("epilepsy" not in line for line in lines)
