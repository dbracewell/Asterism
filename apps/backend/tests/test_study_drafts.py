"""US-53.2: bounded flashcard drafts from project files with citation capture."""

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from asterism.domains.agent.execution_scope import FileProvenance
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel, KnowledgeExtractionStatus
from asterism.domains.knowledge.vector_store import LanceDbVectorStore, StoredChunk, VectorChunk
from asterism.domains.projects.models import ProjectFileModel
from asterism.domains.retrieval.service import RetrievalArtifact, RetrievalSnapshot
from asterism.domains.retrieval.sources import SourceReader, SourceUnavailable
from asterism.domains.settings.models import LLMModel
from asterism.domains.study import generation
from asterism.domains.study.models import StudyCardModel
from sqlalchemy import delete, func, select, update
from test_projects_api import auth, create
from test_projects_api import project_api as _project_api

project_api = _project_api
MODEL = str(uuid.UUID(int=1))


class FakeVectors:
    """Chunks keyed by file id; hooks let a test change state mid-read."""

    def __init__(self):
        self.chunks: dict[str, list[StoredChunk]] = {}
        self.fail: set[str] = set()
        self.on_read = None

    def put(self, file_id, texts, generation=1):
        self.chunks[file_id] = [
            StoredChunk(f"{file_id}-c{index}", file_id, generation, index, "text", text)
            for index, text in enumerate(texts)
        ]

    async def get_file_chunks(self, *, user_id, file_id, artifact_generation, limit):
        if file_id in self.fail:
            raise RuntimeError("lance down")
        if self.on_read:
            await self.on_read(file_id)
        return [c for c in self.chunks.get(file_id, []) if c.artifact_generation == artifact_generation][:limit]


class FakeModel:
    """Replies per file, keyed by a marker found in the prompt's source text."""

    def __init__(self):
        self.replies: dict[str, object] = {}
        self.prompts: list[str] = []

    def client(self, *_args, **_kwargs):
        async def generate(*, messages):
            prompt = messages[-1].content
            self.prompts.append(prompt)
            for marker, reply in self.replies.items():
                if marker in prompt:
                    if callable(reply):
                        reply = await reply(prompt)
                    if isinstance(reply, Exception):
                        return SimpleNamespace(exception=reply, content=None)
                    return SimpleNamespace(exception=None, content=reply)
            return SimpleNamespace(exception=None, content='{"cards": []}')

        return SimpleNamespace(generate=generate)


def cards(*items):
    return json.dumps({"cards": [{"front": f, "back": b, "source": s} for f, b, s in items]})


@pytest.fixture
def drafts_api(project_api, monkeypatch):
    client, sessions, tmp_path = project_api

    @asynccontextmanager
    async def session_context():
        async with sessions() as session:
            yield session

    vectors, model = FakeVectors(), FakeModel()
    monkeypatch.setattr("asterism.domains.study.sources.get_async_db_session", session_context)
    monkeypatch.setattr("asterism.domains.study.sources.vector_store", vectors)
    monkeypatch.setattr("asterism.domains.study.generation.create_llm_client", model.client)
    return SimpleNamespace(client=client, sessions=sessions, vectors=vectors, model=model)


async def add_file(api, project_id, name, *, user="a", status=KnowledgeExtractionStatus.READY, texts=None):
    async with api.sessions() as session:
        file = UserFileModel(
            user_id=user,
            filename=name,
            original_name=name,
            storage_key=str(uuid.uuid4()),
            size=1,
            mime_type="text/plain",
            kind=FileKind.TEXT,
            sha256="a" * 64,
        )
        session.add(file)
        await session.flush()
        if project_id is not None:
            session.add(ProjectFileModel(project_id=uuid.UUID(project_id), file_id=file.id, user_id=user))
        session.add(
            FileKnowledgeArtifactModel(
                user_id=user,
                file_id=file.id,
                generation=1,
                processing_profile_generation=1,
                status=status,
                is_current=True,
                searchable=status == KnowledgeExtractionStatus.READY,
            )
        )
        await session.commit()
        file_id = str(file.id)
    api.vectors.put(file_id, texts if texts is not None else [f"{name} chunk one", f"{name} chunk two"])
    return file_id


async def setup_deck(api, user="a"):
    project = await create(api.client)
    response = await api.client.post(
        f"/projects/{project['id']}/study/decks", headers=auth(user), json={"name": "Deck"}
    )
    assert response.status_code == 201, response.text
    return project["id"], response.json()["id"]


def drafts_path(project_id, deck_id):
    return f"/projects/{project_id}/study/decks/{deck_id}/card-drafts"


async def draft(api, project_id, deck_id, user="a", **body):
    return await api.client.post(
        drafts_path(project_id, deck_id), headers=auth(user), json={"model_id": MODEL, "count": 4, **body}
    )


@pytest.mark.asyncio
async def test_drafts_cite_chunks_split_the_count_and_are_not_saved(drafts_api):
    api = drafts_api
    project_id, deck_id = await setup_deck(api)
    first = await add_file(api, project_id, "cells.txt")
    second = await add_file(api, project_id, "genes.txt")
    api.model.replies = {
        "cells.txt": cards(("What is ATP?", "Energy currency", "S2"), ("Q2", "A2", "S1"), ("Q3", "A3", "S1")),
        "genes.txt": cards(("What is DNA?", "Genetic material", "[s1]"), ("G2", "B2", "S9")),
    }

    response = await draft(api, project_id, deck_id, count=3)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    # 3 cards over 2 files: 2 from the first, 1 from the second.
    assert [d["front"] for d in body["drafts"]] == ["What is ATP?", "Q2", "What is DNA?"]
    assert body["drafts"][0]["citations"] == [
        {
            "file_id": first,
            "chunk_id": f"{first}-c1",
            "artifact_generation": 1,
            "excerpt": "cells.txt chunk two",
            "available": True,
            "file_name": "cells.txt",
        }
    ]
    assert body["drafts"][2]["citations"][0]["chunk_id"] == f"{second}-c0"
    assert body["files"] == [
        {
            "file_id": first,
            "file_name": "cells.txt",
            "status": "used",
            "message": None,
            "card_count": 2,
            "truncated": False,
        },
        {
            "file_id": second,
            "file_name": "genes.txt",
            "status": "used",
            "message": None,
            "card_count": 1,
            "truncated": False,
        },
    ]
    async with api.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(StudyCardModel)) == 0


@pytest.mark.asyncio
async def test_unknown_source_label_falls_back_to_a_file_citation(drafts_api):
    api = drafts_api
    project_id, deck_id = await setup_deck(api)
    file_id = await add_file(api, project_id, "notes.txt")
    api.model.replies = {"notes.txt": cards(("Q", "A", "S7"), ("Q2", "A2", None))}
    body = (await draft(api, project_id, deck_id, count=2)).json()
    for item in body["drafts"]:
        assert item["citations"] == [
            {
                "file_id": file_id,
                "chunk_id": None,
                "artifact_generation": None,
                "excerpt": None,
                "available": True,
                "file_name": "notes.txt",
            }
        ]


@pytest.mark.asyncio
async def test_failed_files_do_not_abort_the_batch(drafts_api):
    api = drafts_api
    project_id, deck_id = await setup_deck(api)
    pending = await add_file(api, project_id, "pending.txt", status=KnowledgeExtractionStatus.RUNNING)
    failed = await add_file(api, project_id, "failed.txt", status=KnowledgeExtractionStatus.FAILED)
    garbage = await add_file(api, project_id, "garbage.txt")
    broken = await add_file(api, project_id, "broken.txt")
    erroring = await add_file(api, project_id, "error.txt")
    good = await add_file(api, project_id, "good.txt")
    api.vectors.fail.add(broken)
    api.model.replies = {
        "garbage.txt": "I cannot do that",
        "error.txt": RuntimeError("provider down"),
        "good.txt": cards(("Q", "A", "S1")),
    }
    response = await draft(api, project_id, deck_id, count=6)
    assert response.status_code == 200, response.text
    body = response.json()
    assert [d["front"] for d in body["drafts"]] == ["Q"]
    results = {item["file_id"]: item for item in body["files"]}
    assert results[pending]["message"] == "This file is still being processed."
    assert results[failed]["message"] == "This file could not be processed."
    assert results[broken]["message"] == "This file could not be read; try again."
    assert results[garbage]["message"] == "The model returned an unreadable reply."
    assert results[erroring]["message"] == "The model could not draft cards for this file."
    assert results[good]["status"] == "used"
    assert [results[f]["status"] for f in (pending, failed, broken, garbage, erroring)] == ["failed"] * 5


@pytest.mark.asyncio
async def test_scope_is_the_live_project(drafts_api):
    api = drafts_api
    project_id, deck_id = await setup_deck(api)
    other = await create(api.client, name="Other")
    elsewhere = await add_file(api, other["id"], "elsewhere.txt")
    foreign = await add_file(api, None, "theirs.txt", user="b")
    for file_id in (elsewhere, foreign, str(uuid.uuid4())):
        response = await draft(api, project_id, deck_id, file_ids=[file_id])
        assert response.status_code == 400
        assert response.json()["detail"] == "Choose files that are in this project"
    assert api.model.prompts == []
    # Another user's project and deck look missing.
    assert (await draft(api, project_id, deck_id, user="b")).status_code == 404
    other_deck = await api.client.post(f"/projects/{other['id']}/study/decks", headers=auth(), json={"name": "X"})
    assert (await draft(api, project_id, other_deck.json()["id"])).status_code == 404


@pytest.mark.asyncio
async def test_file_removed_from_project_mid_read_fails_closed(drafts_api):
    api = drafts_api
    project_id, deck_id = await setup_deck(api)
    removed = await add_file(api, project_id, "removed.txt")
    kept = await add_file(api, project_id, "kept.txt")

    async def detach(file_id):
        if file_id == removed:
            async with api.sessions() as session:
                await session.execute(delete(ProjectFileModel).where(ProjectFileModel.file_id == uuid.UUID(removed)))
                await session.commit()

    api.vectors.on_read = detach
    api.model.replies = {"kept.txt": cards(("Q", "A", "S1"), ("Q2", "A2", "S1"))}
    body = (await draft(api, project_id, deck_id, count=2)).json()
    results = {item["file_id"]: item for item in body["files"]}
    assert results[removed]["message"] == "This file is no longer in the project."
    assert all("removed.txt" not in prompt for prompt in api.model.prompts)
    assert [d["front"] for d in body["drafts"]] == ["Q", "Q2"]
    assert results[kept]["card_count"] == 2


@pytest.mark.asyncio
async def test_whole_project_scope_and_its_limits(drafts_api):
    api = drafts_api
    project_id, deck_id = await setup_deck(api)
    empty = await draft(api, project_id, deck_id)
    assert empty.status_code == 400
    assert empty.json()["detail"] == "This project has no files to draft from"
    ids = [await add_file(api, project_id, f"file{i}.txt") for i in range(3)]
    api.model.replies = {f"file{i}.txt": cards((f"Q{i}", "A", "S1")) for i in range(3)}
    body = (await draft(api, project_id, deck_id, count=3, file_ids=None)).json()
    assert {item["file_id"] for item in body["files"]} == set(ids)
    assert len(body["drafts"]) == 3
    for i in range(3, 11):
        await add_file(api, project_id, f"file{i}.txt")
    too_many = await draft(api, project_id, deck_id)
    assert too_many.status_code == 400
    assert "more than 10 files" in too_many.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {"count": 0},
        {"count": 31},
        {"file_ids": []},
        {"file_ids": [str(uuid.uuid4()) for _ in range(11)]},
        {"file_ids": [str(uuid.UUID(int=5))] * 2},
        {"model_id": None},
        {"extra": True},
    ],
)
async def test_request_validation(drafts_api, body):
    api = drafts_api
    project_id, deck_id = await setup_deck(api)
    assert (await draft(api, project_id, deck_id, **body)).status_code == 422


@pytest.mark.asyncio
async def test_unavailable_model_is_a_conflict(drafts_api):
    api = drafts_api
    project_id, deck_id = await setup_deck(api)
    file_id = await add_file(api, project_id, "notes.txt")
    async with api.sessions() as session:
        await session.execute(update(LLMModel).where(LLMModel.id == uuid.UUID(int=2)).values(is_active=False))
        await session.commit()
    for model_id in (str(uuid.UUID(int=2)), str(uuid.uuid4())):
        response = await draft(api, project_id, deck_id, model_id=model_id, file_ids=[file_id])
        assert response.status_code == 409, response.text
    assert api.model.prompts == []


@pytest.mark.asyncio
async def test_input_budget_and_card_count_are_bounded(drafts_api, monkeypatch):
    api = drafts_api
    monkeypatch.setattr(generation, "MAX_INPUT_CHARS", 50)
    project_id, deck_id = await setup_deck(api)
    first = await add_file(api, project_id, "a.txt", texts=["A" * 20, "B" * 20, "C" * 20])
    await add_file(api, project_id, "b.txt", texts=["D" * 40])
    api.model.replies = {
        "AAAA": cards(*[(f"Q{i}", "A", "S1") for i in range(10)]),
        "DDDD": cards(("Q", "A", "S1")),
    }
    body = (await draft(api, project_id, deck_id, count=3)).json()
    # 25 characters per file: all of chunk one and five of chunk two.
    prompt = next(p for p in api.model.prompts if "AAAA" in p)
    assert (
        "A" * 20 in prompt and "B" * 5 in prompt and "B" * 6 not in prompt and "C" not in prompt.split("<sources>")[1]
    )
    other = next(p for p in api.model.prompts if "DDDD" in p)
    assert "D" * 25 in other and "D" * 26 not in other
    results = {item["file_id"]: item for item in body["files"]}
    assert results[first]["truncated"] is True
    # The first file's share is 2 even though the model returned 10 cards.
    assert results[first]["card_count"] == 2
    assert len(body["drafts"]) == 3


@pytest.mark.asyncio
async def test_slow_model_calls_and_the_request_deadline_fail_only_their_files(drafts_api, monkeypatch):
    api = drafts_api
    project_id, deck_id = await setup_deck(api)
    slow = await add_file(api, project_id, "slow.txt")
    fast = await add_file(api, project_id, "fast.txt")

    async def hang(_prompt):
        await asyncio.sleep(5)
        return cards(("late", "A", "S1"))

    api.model.replies = {"slow.txt": hang, "fast.txt": cards(("Q", "A", "S1"))}
    monkeypatch.setattr(generation, "MODEL_CALL_SECONDS", 0.05)
    body = (await draft(api, project_id, deck_id, count=2)).json()
    results = {item["file_id"]: item for item in body["files"]}
    assert results[slow]["message"] == "The model took too long for this file."
    assert results[fast]["status"] == "used"

    monkeypatch.setattr(generation, "MODEL_CALL_SECONDS", 60.0)
    monkeypatch.setattr(generation, "REQUEST_SECONDS", 0.2)
    body = (await draft(api, project_id, deck_id, count=2)).json()
    results = {item["file_id"]: item for item in body["files"]}
    assert results[slow]["message"] == generation.TIME_LIMIT_MESSAGE
    assert results[fast]["status"] == "used"


@pytest.mark.asyncio
async def test_more_files_than_cards_reports_unused_files(drafts_api):
    api = drafts_api
    project_id, deck_id = await setup_deck(api)
    first = await add_file(api, project_id, "one.txt")
    second = await add_file(api, project_id, "two.txt")
    api.model.replies = {"one.txt": cards(("Q", "A", "S1"))}
    body = (await draft(api, project_id, deck_id, count=1, file_ids=[first, second])).json()
    results = {item["file_id"]: item for item in body["files"]}
    assert results[first]["status"] == "used"
    assert results[second] == {
        "file_id": second,
        "file_name": "two.txt",
        "status": "failed",
        "message": "Not needed for the requested number of cards.",
        "card_count": 0,
        "truncated": False,
    }


@pytest.mark.asyncio
async def test_accepting_a_draft_saves_its_citation_link(drafts_api):
    api = drafts_api
    project_id, deck_id = await setup_deck(api)
    await add_file(api, project_id, "cells.txt")
    api.model.replies = {"cells.txt": cards(("What is ATP?", "Energy", "S1"))}
    item = (await draft(api, project_id, deck_id, count=1)).json()["drafts"][0]
    citations = [
        {key: value for key, value in citation.items() if key not in ("available", "file_name")}
        for citation in item["citations"]
    ]
    saved = await api.client.post(
        f"/projects/{project_id}/study/decks/{deck_id}/cards",
        headers=auth(),
        json={"front": item["front"], "back": item["back"], "citations": citations},
    )
    assert saved.status_code == 201, saved.text
    assert saved.json()["citations"] == item["citations"]


# --- SourceReader and the LanceDB chunk read ---------------------------------


def snapshot(file_id, generation=1, in_scope=True):
    return RetrievalSnapshot(
        (FileProvenance(file_id=file_id, sources=("project",)),) if in_scope else (),
        (RetrievalArtifact(file_id, generation, KnowledgeExtractionStatus.READY, True),),
        1,
    )


@pytest.mark.asyncio
async def test_source_reader_fails_closed_when_the_generation_changes():
    file_id = uuid.uuid4()
    reads = iter([snapshot(file_id, 1), snapshot(file_id, 2)])

    async def read():
        return next(reads)

    vectors = FakeVectors()
    vectors.put(str(file_id), ["text"])
    reader = SourceReader(user_id="a", read_snapshot=read, vectors=vectors, max_chunks=10)
    with pytest.raises(SourceUnavailable, match="changed while it was being read"):
        await reader.read_file(file_id, max_chars=100)


@pytest.mark.asyncio
async def test_source_reader_skips_blank_and_stale_chunks():
    file_id = uuid.uuid4()

    async def read():
        return snapshot(file_id)

    vectors = FakeVectors()
    vectors.chunks[str(file_id)] = [
        StoredChunk("blank", str(file_id), 1, 0, "text", "   "),
        StoredChunk("kept", str(file_id), 1, 1, "text", "real text"),
    ]
    reader = SourceReader(user_id="a", read_snapshot=read, vectors=vectors, max_chunks=10)
    excerpt = await reader.read_file(file_id, max_chars=100)
    assert [chunk.chunk_id for chunk in excerpt.chunks] == ["kept"]
    vectors.chunks[str(file_id)] = [StoredChunk("blank", str(file_id), 1, 0, "text", " ")]
    with pytest.raises(SourceUnavailable, match="no readable text"):
        await reader.read_file(file_id, max_chars=100)


@pytest.mark.asyncio
async def test_lancedb_reads_file_chunks_in_order_for_one_owner_and_generation(tmp_path: Path):
    store = LanceDbVectorStore(tmp_path / "vectors", dimension=2, max_concurrency=1)
    await store.add(
        [
            VectorChunk("c2", "user-a", "file-a", 1, 2, "text", "third", [1.0, 0.0]),
            VectorChunk("c0", "user-a", "file-a", 1, 0, "text", "first", [1.0, 0.0]),
            VectorChunk("c1", "user-a", "file-a", 1, 1, "caption", "second", [0.0, 1.0]),
            VectorChunk("new", "user-a", "file-a", 2, 0, "text", "newer generation", [1.0, 0.0]),
            VectorChunk("x", "user-b", "file-a", 1, 0, "text", "other owner", [1.0, 0.0]),
            VectorChunk("y", "user-a", "file-b", 1, 0, "text", "other file", [1.0, 0.0]),
        ]
    )
    chunks = await store.get_file_chunks(user_id="user-a", file_id="file-a", artifact_generation=1, limit=10)
    assert [(chunk.id, chunk.content) for chunk in chunks] == [("c0", "first"), ("c1", "second"), ("c2", "third")]
    first_two = await store.get_file_chunks(user_id="user-a", file_id="file-a", artifact_generation=1, limit=2)
    assert [chunk.id for chunk in first_two] == ["c0", "c1"]
    assert await store.get_file_chunks(user_id="user-a'--", file_id="file-a", artifact_generation=1, limit=10) == []
    await store.close()
