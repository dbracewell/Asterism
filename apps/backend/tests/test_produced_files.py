"""US-56.2: produced-file registration, limits, type detection, provenance and scope."""

import asyncio
import uuid
from types import SimpleNamespace

import asterism.db.database as database
import pytest
from asterism.core import config
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.models import ChatFileModel, MessageModel
from asterism.domains.chat.schemas import NewMessageRequest
from asterism.domains.chat.service import add_message
from asterism.domains.files.models import FileKind, FileOrigin, UserFileModel
from asterism.domains.files.produced import (
    ProducedFileRejected,
    detect_produced_type,
    file_reference_token,
    register_produced_file,
)
from sqlalchemy import delete, select
from test_chat_file_scope import chat, scope, seed_agent
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api


def _png() -> bytes:
    from io import BytesIO

    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (4, 4), "red").save(buffer, format="PNG")
    return buffer.getvalue()


PNG = _png()
SVG = b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


@pytest.fixture
def produced(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    started: list[uuid.UUID] = []
    monkeypatch.setattr(
        "asterism.domains.files.produced.start_ingestion",
        lambda *, user_id, file_id, artifact: started.append(file_id),
    )
    # project_api patched the shared session factory; this module bound it at import.
    monkeypatch.setattr("asterism.domains.files.produced.get_async_db_session", database.get_async_db_session)
    return SimpleNamespace(client=client, sessions=sessions, root=tmp_path, started=started)


async def run(p, user="a"):
    """Accept a General chat turn and record its run, as job start does."""
    agent = await seed_agent(p.sessions, user)
    record = await chat(p.client, agent, user=user)
    chat_id, message_id = uuid.UUID(record["info"]["id"]), uuid.UUID(record["messages"][0]["id"])
    async with p.sessions() as session:
        execution = await prepare_execution(user_id=user, chat_id=chat_id, message_id=message_id, session=session)
        await session.commit()
    return record, SimpleNamespace(user_id=user, chat_id=chat_id, execution_id=execution.id, agent_id=uuid.UUID(agent))


def stored_sources(p):
    return sorted(path for path in p.root.rglob("source*") if path.is_file())


@pytest.mark.asyncio
async def test_registration_records_provenance_detects_type_and_returns_token(produced):
    p = produced
    record, scope_ = await run(p)
    file = await register_produced_file(scope_, tool="image_gen", name="chart.txt", content=PNG)

    assert (file.mime_type, file.filename, file.kind) == ("image/png", "chart.png", FileKind.IMAGE)
    assert file.token == f"asterism-file:{file.file_id}" == file_reference_token(file.file_id)
    assert file.token == file.token.lower()
    assert file.embed == f"![chart.png]({file.token})"
    assert file.embed in file.tool_result()
    assert p.started == [file.file_id]
    async with p.sessions() as session:
        row = await session.get(UserFileModel, file.file_id)
        assert row is not None
        assert (row.user_id, row.origin, row.produced_tool) == ("a", FileOrigin.AGENT, "image_gen")
        assert (row.produced_chat_id, row.produced_execution_id, row.produced_agent_id) == (
            scope_.chat_id,
            scope_.execution_id,
            scope_.agent_id,
        )
        assert row.thumbnail is not None
        assert await session.get(ChatFileModel, (scope_.chat_id, file.file_id)) is not None

    info = await p.client.get(f"/chat/{scope_.chat_id}/files/{file.file_id}/info", headers=auth())
    assert info.status_code == 200, info.text
    assert info.json()["origin"] == "agent"
    assert (await p.client.get(f"/chat/{scope_.chat_id}/files/{file.file_id}", headers=auth())).content == PNG
    library = (await p.client.get("/files/", headers=auth())).json()["files"]
    assert {entry["filename"]: entry["origin"] for entry in library} == {"chart.png": "agent"}


@pytest.mark.parametrize(
    ("name", "content", "expected"),
    [
        ("chart.txt", PNG, ("image/png", "chart.png")),
        ("photo.jpg", b"\xff\xd8\xff\xe0" + b"\x00" * 32, ("image/jpeg", "photo.jpg")),
        ("drawing.png", SVG, ("image/svg+xml", "drawing.svg")),
        ("drawing.svg", b"\xef\xbb\xbf  <svg/>", ("image/svg+xml", "drawing.svg")),
        ("data.csv", b"a,b\n1,2\n", ("text/csv", "data.csv")),
        ("notes.md", "# Café".encode(), ("text/markdown", "notes.md")),
        ("fake.png", b"plain words", ("text/plain", "fake.txt")),
        ("fake.svg", b"not markup", ("text/plain", "fake.txt")),
        ("noext", b"hello", ("text/plain", "noext.txt")),
        ("report.pdf", b"%PDF-1.7\n" + b"x" * 32, ("application/pdf", "report.pdf")),
    ],
)
def test_type_is_detected_from_content_not_the_name(name, content, expected):
    assert detect_produced_type(name, content) == expected


def test_unknown_binary_is_rejected():
    with pytest.raises(ProducedFileRejected):
        detect_produced_type("blob.dat", bytes(range(256)))
    with pytest.raises(ProducedFileRejected):
        detect_produced_type("nul.txt", b"text\x00more")


@pytest.mark.asyncio
async def test_rejections_store_nothing(produced, monkeypatch):
    p = produced
    _, scope_ = await run(p)
    monkeypatch.setattr(config, "max_upload_file_size_bytes", 100)
    attempts = [
        dict(name="a.png", content=PNG + b"\x00" * 100),  # over the per-file limit
        dict(name="run.exe", content=b"MZ text"),  # denied extension
        dict(name="../", content=b"text"),  # malformed name
        dict(name="blob.dat", content=bytes(range(50))),  # unknown binary
    ]
    for attempt in attempts:
        with pytest.raises(ProducedFileRejected):
            await register_produced_file(scope_, tool="t", **attempt)
    with pytest.raises(ProducedFileRejected):
        await register_produced_file(scope_, tool=" ", name="a.txt", content=b"x")
    foreign_run = SimpleNamespace(**{**vars(scope_), "execution_id": uuid.uuid4()})
    with pytest.raises(ProducedFileRejected):
        await register_produced_file(foreign_run, tool="t", name="a.txt", content=b"x")
    without_run = SimpleNamespace(**{**vars(scope_), "execution_id": None})
    with pytest.raises(ProducedFileRejected):
        await register_produced_file(without_run, tool="t", name="a.txt", content=b"x")
    async with p.sessions() as session:
        assert list(await session.scalars(select(UserFileModel))) == []
        assert list(await session.scalars(select(ChatFileModel))) == []
    assert stored_sources(p) == []


@pytest.mark.asyncio
async def test_run_from_another_users_or_chats_scope_is_rejected(produced):
    p = produced
    _, a_run = await run(p, "a")
    _, b_run = await run(p, "b")
    _, a_other = await run(p, "a")
    # A's identity with B's chat/run, and A's run claimed for a different A chat.
    for forged in (
        SimpleNamespace(**{**vars(a_run), "chat_id": b_run.chat_id, "execution_id": b_run.execution_id}),
        SimpleNamespace(**{**vars(a_run), "chat_id": a_other.chat_id}),
    ):
        with pytest.raises(ProducedFileRejected):
            await register_produced_file(forged, tool="t", name="a.txt", content=b"x")
    async with p.sessions() as session:
        assert list(await session.scalars(select(UserFileModel))) == []
    assert stored_sources(p) == []


@pytest.mark.asyncio
async def test_per_run_count_and_byte_limits_hold_under_concurrency(produced, monkeypatch):
    p = produced
    _, scope_ = await run(p)
    _, other = await run(p)
    monkeypatch.setattr(config, "max_produced_files_per_run", 2)
    results = await asyncio.gather(
        *(register_produced_file(scope_, tool="t", name=f"f{i}.txt", content=b"x") for i in range(4)),
        return_exceptions=True,
    )
    assert sum(not isinstance(result, Exception) for result in results) == 2
    assert all(isinstance(result, ProducedFileRejected) for result in results if isinstance(result, Exception))
    # Limits are per run: another run of the same user is unaffected.
    await register_produced_file(other, tool="t", name="g.txt", content=b"x")

    monkeypatch.setattr(config, "max_produced_files_per_run", 20)
    monkeypatch.setattr(config, "max_produced_bytes_per_run", 10)
    _, third = await run(p)
    await register_produced_file(third, tool="t", name="h.txt", content=b"12345678")
    with pytest.raises(ProducedFileRejected):
        await register_produced_file(third, tool="t", name="i.txt", content=b"123")
    async with p.sessions() as session:
        assert len(list(await session.scalars(select(UserFileModel)))) == 4
    assert len(stored_sources(p)) == 4


@pytest.mark.asyncio
async def test_names_are_deduplicated_in_the_library(produced):
    p = produced
    _, scope_ = await run(p)
    first = await register_produced_file(scope_, tool="t", name="out.txt", content=b"one")
    second = await register_produced_file(scope_, tool="t", name="out.txt", content=b"one")
    assert first.file_id != second.file_id
    assert (first.filename, second.filename) == ("out.txt", "out(2).txt")


@pytest.mark.asyncio
async def test_sub_agent_files_belong_to_the_parent_chat(produced):
    p = produced
    _, scope_ = await run(p)
    sub_agent = uuid.uuid4()
    child = SimpleNamespace(**{**vars(scope_), "agent_id": sub_agent, "is_sub_agent": True})
    file = await register_produced_file(child, tool="t", name="child.txt", content=b"from child")
    async with p.sessions() as session:
        row = await session.get(UserFileModel, file.file_id)
        assert row is not None
        assert (row.user_id, row.produced_chat_id, row.produced_agent_id) == ("a", scope_.chat_id, sub_agent)
    assert file.file_id in {
        uuid.UUID(i) for i in (await scope(p.client, {"info": {"id": str(scope_.chat_id)}}))["allowed_file_ids"]
    }


@pytest.mark.asyncio
async def test_produced_files_join_scope_only_on_their_runs_branch(produced):
    p = produced
    record, scope_ = await run(p)
    chat_id, request_id = scope_.chat_id, uuid.UUID(record["messages"][0]["id"])
    file = await register_produced_file(scope_, tool="t", name="made.txt", content=b"made")
    current = await scope(p.client, record)
    assert str(file.file_id) in current["allowed_file_ids"]
    entry = next(f for f in current["files"] if f["file_id"] == str(file.file_id))
    assert entry["sources"] == ["chat"] and entry["message_ids"] == [str(request_id)]

    # The run's step sits on one branch; a sibling turn without the run is another.
    async with p.sessions() as session:
        step = await add_message(
            "a",
            chat_id,
            NewMessageRequest(role="assistant", content="step", parent_message_id=request_id, model_id=uuid.uuid4()),
            session,
        )
        message = await session.get(MessageModel, step.id)
        assert message is not None
        message.execution_id = scope_.execution_id
        request = await session.get(MessageModel, request_id)
        assert request is not None
        request.pending_execution_id = None
        await session.commit()
        sibling = await add_message(
            "a",
            chat_id,
            NewMessageRequest(role="assistant", content="other", parent_message_id=request_id, model_id=uuid.uuid4()),
            session,
        )
    assert str(file.file_id) not in (await scope(p.client, record))["allowed_file_ids"]
    assert (await p.client.get(f"/chat/{chat_id}/files/{file.file_id}", headers=auth())).status_code == 404
    response = await p.client.patch(
        f"/chat/{chat_id}/message/{request_id}", headers=auth(), json={"active_child_id": str(step.id)}
    )
    assert response.status_code == 200, response.text
    current = await scope(p.client, record)
    assert str(file.file_id) in current["allowed_file_ids"]
    entry = next(f for f in current["files"] if f["file_id"] == str(file.file_id))
    assert entry["message_ids"] == [str(step.id)]
    assert sibling.id != step.id

    # Other chats and other users never see it; removing membership revokes it.
    _, other = await run(p)
    assert str(file.file_id) not in (await scope(p.client, {"info": {"id": str(other.chat_id)}}))["allowed_file_ids"]
    assert (await p.client.get(f"/chat/{other.chat_id}/files/{file.file_id}", headers=auth())).status_code == 404
    for suffix in ("", "/info"):
        response = await p.client.get(f"/chat/{chat_id}/files/{file.file_id}{suffix}", headers=auth("b"))
        assert response.status_code == 404
    async with p.sessions() as session:
        await session.execute(delete(ChatFileModel).where(ChatFileModel.file_id == file.file_id))
        await session.commit()
    assert str(file.file_id) not in (await scope(p.client, record))["allowed_file_ids"]
    async with p.sessions() as session:
        assert await session.get(UserFileModel, file.file_id) is not None


@pytest.mark.asyncio
async def test_deleting_the_chat_keeps_the_produced_file_in_the_library(produced):
    p = produced
    _, scope_ = await run(p)
    file = await register_produced_file(scope_, tool="t", name="keep.txt", content=b"keep")
    assert (await p.client.delete(f"/chat/{scope_.chat_id}", headers=auth())).status_code in (200, 204)
    async with p.sessions() as session:
        row = await session.get(UserFileModel, file.file_id)
        assert row is not None and row.produced_chat_id == scope_.chat_id
        assert list(await session.scalars(select(ChatFileModel))) == []
