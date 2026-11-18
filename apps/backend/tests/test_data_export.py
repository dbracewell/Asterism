"""Download my data (US-86.8): what the archive holds, who can download it, and its lifecycle."""

import json
import sqlite3
import time
import uuid
import zipfile
from contextlib import asynccontextmanager

import pytest
from asterism.core import config
from asterism.domains.chat.models import MessageModel
from asterism.domains.data_export import service
from asterism.domains.data_export.models import DataExportModel
from asterism.domains.files.store import LocalFileStore
from asterism.domains.usage.models import UsageRecordModel
from asterism.domains.user.models import UserModel
from migration_harness import upgrade_to
from test_migrations import migration_db as _migration_db
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
migration_db = _migration_db

CANARY_A = "CANARY-OWN-4f2a"
CANARY_B = "CANARY-OTHER-9c1d"


@pytest.fixture
def exports(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    store = LocalFileStore(tmp_path / "files")
    for module in ("files.service", "data_export.archive"):
        monkeypatch.setattr(f"asterism.domains.{module}.get_file_store", lambda: store)
    monkeypatch.setattr("asterism.domains.files.service.start_ingestion", lambda **_: None)

    @asynccontextmanager
    async def session_context(session=None):
        async with sessions() as fresh:
            yield fresh

    monkeypatch.setattr("asterism.domains.data_export.service.get_async_db_session", session_context)
    return client, sessions, tmp_path


async def finished(user_id: str) -> None:
    task = service.export_jobs._tasks.get(user_id)
    if task is not None:
        await task


async def seed(client, sessions, user: str, canary: str) -> dict:
    headers = auth(user)
    about = (await client.get("/users/me/about", headers=headers)).json()
    saved = await client.put(
        "/users/me/about",
        headers=headers,
        json={"about_md": f"I study tides. {canary}", "expected_revision": about["revision"]},
    )
    assert saved.status_code == 200, saved.text
    uploaded = await client.post(
        "/files/", headers=headers, files={"files": ("notes.txt", f"Lecture notes {canary}".encode(), "text/plain")}
    )
    assert uploaded.status_code == 201, uploaded.text
    project = (await client.post("/projects/", headers=headers, json={"name": f"Biology {canary}"})).json()
    base = f"/projects/{project['id']}/study"
    deck = (await client.post(f"{base}/decks", headers=headers, json={"name": "Photosynthesis"})).json()
    card = await client.post(
        f"{base}/decks/{deck['id']}/cards", headers=headers, json={"front": f"What is {canary}?", "back": "ATP"}
    )
    assert card.status_code == 201, card.text
    skill = await client.post(
        "/skills/",
        headers=headers,
        json={"content": f"---\nname: tides-{user}\ndescription: Tides.\n---\n# Tides\n{canary}\n"},
    )
    assert skill.status_code == 201, skill.text
    chat = await client.post(
        "/chat/",
        headers=headers,
        json={"request_id": str(uuid.uuid4()), "user_prompt": f"Explain {canary}", "model_id": str(uuid.UUID(int=1))},
    )
    assert chat.status_code == 200, chat.text
    chat_id = uuid.UUID(chat.json()["info"]["id"])
    question = chat.json()["messages"][-1]["id"]
    async with sessions() as session:
        # Two answers to the same question: the second is on the active branch.
        answers = [
            MessageModel(
                chat_id=chat_id,
                user_id=user,
                role="assistant",
                content=text,
                parent_message_id=uuid.UUID(question),
                status="completed",
            )
            for text in (f"First answer {canary}", f"Second answer {canary}")
        ]
        session.add_all(answers)
        await session.flush()
        parent = await session.get(MessageModel, uuid.UUID(question))
        parent.active_child_id = answers[1].id
        session.add(UsageRecordModel(user_id=user, source="chat", model_name="Chat A", input_tokens=7, output_tokens=3))
        await session.commit()
    return {"chat_id": chat_id}


def archive_text(path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


@pytest.mark.asyncio
async def test_the_archive_holds_everything_the_person_owns_and_nothing_else(exports):
    client, sessions, _ = exports
    await seed(client, sessions, "a", CANARY_A)
    await seed(client, sessions, "b", CANARY_B)

    started = await client.post("/data-export", headers=auth())
    assert started.status_code == 202 and started.json()["status"] == "pending"
    await finished("a")
    state = (await client.get("/data-export", headers=auth())).json()["export"]
    assert state["status"] == "ready", state
    assert state["expires_at"] - state["completed_at"] == service.RETENTION_SECONDS

    entries = archive_text(service.archive_path("a", uuid.UUID(state["id"])))
    names = {name.split("/", 1)[1] for name in entries}
    top = next(iter(entries)).split("/", 1)[0]
    assert top.startswith("asterism-data-")
    assert {"README.md", "account.json", "settings.json", "about-you.md", "files/notes.txt"} <= names
    assert any(name.startswith("chats/") and name.endswith("/chat.md") for name in names)
    assert {f"records/{table}.json" for table in ("projects", "study_decks", "study_cards", "usage_records")} <= names

    text = {name.split("/", 1)[1]: content.decode("utf-8", "replace") for name, content in entries.items()}
    assert CANARY_A in text["about-you.md"]
    assert text["files/notes.txt"] == f"Lecture notes {CANARY_A}"
    assert "tides-a" in next(value for key, value in text.items() if key.startswith("skills/"))
    chat_md = next(value for key, value in text.items() if key.endswith("chat.md"))
    # The readable chat follows the branch shown in the app.
    assert f"Explain {CANARY_A}" in chat_md and f"Second answer {CANARY_A}" in chat_md
    assert f"First answer {CANARY_A}" not in chat_md
    chat_json = json.loads(next(value for key, value in text.items() if key.endswith("chat.json")))
    assert {message["content"] for message in chat_json["messages"]} >= {
        f"First answer {CANARY_A}",
        f"Second answer {CANARY_A}",
    }
    cards = json.loads(text["records/study_cards.json"])
    assert [card["front"] for card in cards] == [f"What is {CANARY_A}?"]
    assert json.loads(text["records/usage_records.json"])[0]["input_tokens"] == 7
    assert "models" not in json.loads(text["settings.json"])
    assert json.loads(text["account.json"])["id"] == "a"

    everything = "\n".join(text.values())
    assert CANARY_B not in everything, "another person's data reached the archive"
    assert "storage_key" not in text["records/files.json"]
    assert "api_key" not in everything and config.system_key not in everything


@pytest.mark.asyncio
async def test_downloads_need_a_valid_unexpired_ticket_for_an_active_account(exports, monkeypatch):
    client, sessions, _ = exports
    assert (await client.post("/data-export/link", headers=auth())).status_code == 404
    await client.post("/data-export", headers=auth())
    # One build at a time per person.
    assert (await client.post("/data-export", headers=auth())).status_code == 409
    await finished("a")

    link = (await client.post("/data-export/link", headers=auth())).json()
    path = link["url"].removeprefix("/api/py")
    assert "user=" not in path and "a@" not in path
    download = await client.get(path)
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/zip"
    assert download.headers["cache-control"] == "no-store"
    assert 'filename="asterism-data-' in download.headers["content-disposition"]
    zipfile.ZipFile(__import__("io").BytesIO(download.content)).testzip()

    export_id, ticket = path.split("/")[2], path.split("ticket=")[1]
    expires, signature = ticket.split(".")
    forged = f"{int(expires) + 3600}.{signature}"
    for bad in (
        f"/data-export/{export_id}/archive?ticket={forged}",
        f"/data-export/{uuid.uuid4()}/archive?ticket={ticket}",
    ):
        assert (await client.get(bad)).status_code == 401
    with monkeypatch.context() as later:
        later.setattr(service.time, "time", lambda: int(expires) + 1)
        assert (await client.get(path)).status_code == 401

    # Another person cannot reach it, and a suspended account cannot download.
    assert (await client.post("/data-export/link", headers=auth("b"))).status_code == 404
    async with sessions() as session:
        user = await session.get(UserModel, "a")
        user.suspended_at = int(time.time())
        await session.commit()
    from asterism.domains.user.lifecycle import clear_suspension_cache

    clear_suspension_cache()
    refused = await client.get(path)
    assert refused.status_code == 401 and "suspended" in refused.json()["detail"]
    clear_suspension_cache()


@pytest.mark.asyncio
async def test_a_new_request_replaces_the_last_and_expired_archives_go(exports):
    client, sessions, _ = exports
    await client.post("/data-export", headers=auth())
    await finished("a")
    first = (await client.get("/data-export", headers=auth())).json()["export"]
    await client.post("/data-export", headers=auth())
    await finished("a")
    second = (await client.get("/data-export", headers=auth())).json()["export"]
    assert second["id"] != first["id"]
    assert not service.archive_path("a", uuid.UUID(first["id"])).exists()
    assert service.archive_path("a", uuid.UUID(second["id"])).exists()

    async with sessions() as session:
        row = await session.get(DataExportModel, uuid.UUID(second["id"]))
        row.expires_at = int(time.time()) - 1
        await session.commit()
    assert (await client.get("/data-export", headers=auth())).json() == {"export": None}
    assert not service.archive_path("a", uuid.UUID(second["id"])).exists()


@pytest.mark.asyncio
async def test_a_restart_fails_interrupted_builds_and_a_failure_is_reported(exports, monkeypatch):
    client, sessions, tmp_path = exports
    async with sessions() as session:
        session.add(DataExportModel(user_id="a", status="running"))
        await session.commit()
    partial = tmp_path / "exports" / "x" / "y.partial"
    partial.parent.mkdir(parents=True)
    partial.write_bytes(b"half")
    await service.recover_exports()
    state = (await client.get("/data-export", headers=auth())).json()["export"]
    assert state["status"] == "failed" and "interrupted" in state["error"]
    assert not partial.exists()

    async def broken(*_args, **_kwargs):
        raise RuntimeError("disk on fire /storage/secret")

    monkeypatch.setattr(service, "build_archive", broken)
    await client.post("/data-export", headers=auth())
    await finished("a")
    state = (await client.get("/data-export", headers=auth())).json()["export"]
    assert state["status"] == "failed" and "secret" not in state["error"]
    assert not list((tmp_path / "exports").glob("*/*.partial"))


@pytest.mark.asyncio
async def test_deleting_the_account_removes_its_archive(exports, monkeypatch):
    client, sessions, _ = exports
    await client.post("/data-export", headers=auth())
    await finished("a")
    state = (await client.get("/data-export", headers=auth())).json()["export"]
    path = service.archive_path("a", uuid.UUID(state["id"]))
    assert path.exists()
    from asterism.domains.user.service import delete_user

    async with sessions() as session:
        await delete_user("a", session)
    assert not path.exists()


@pytest.mark.asyncio
async def test_the_migration_adds_the_table_and_keeps_users(migration_db):
    await upgrade_to(migration_db, "ba46812696ea")
    with sqlite3.connect(migration_db) as db:
        db.execute(
            "INSERT INTO users (id, name, email, created_at, about_md, about_revision)"
            " VALUES ('u', 'U', 'u@x', 1, '', 1)"
        )
    await upgrade_to(migration_db, "head")
    with sqlite3.connect(migration_db) as db:
        assert db.execute("SELECT id FROM users").fetchall() == [("u",)]
        db.execute("INSERT INTO data_exports (id, user_id, status, requested_at) VALUES (x'00', 'u', 'pending', 1)")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("INSERT INTO data_exports (id, user_id, status, requested_at) VALUES (x'01', 'u', 'lost', 1)")
