import asyncio
import uuid
from types import SimpleNamespace

import pytest
from asterism.core import config
from asterism.core.exceptions import CodedException
from asterism.domains.chat.jobs import chat_jobs
from asterism.domains.chat.membership import move_chat
from asterism.domains.chat.models import ChatFileModel, ChatModel, MessageModel
from asterism.domains.chat.schemas import ChatMoveRequest
from asterism.domains.chat.scope import resolve_chat_file_scope
from asterism.domains.chat.search_index import initialize_search_index
from asterism.domains.chat.service import get_one
from asterism.domains.projects.models import ProjectFileModel, ProjectModel
from sqlalchemy import select
from test_chat_file_scope import chat, scope, seed_agent, upload
from test_projects_api import auth, create
from test_projects_api import project_api as _project_api

project_api = _project_api


async def move(client, record, project_id, user="a"):
    return await client.patch(
        f"/chat/{record['info']['id']}/project",
        headers=auth(user),
        json={"project_id": project_id},
    )


@pytest.mark.asyncio
async def test_move_changes_current_context_preserves_history_local_files_and_sources(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    agent = await seed_agent(sessions)
    projects = [await create(client, name=name, system_prompt=f"Instructions for {name}") for name in ("A", "B")]
    files = [await upload(client, name) for name in ("a.txt", "b.txt", "local.txt")]
    for project, file in zip(projects, files, strict=False):
        response = await client.post(
            f"/projects/{project['id']}/files",
            headers=auth(),
            json={"file_ids": [file["id"]], "expected_context_revision": 1},
        )
        assert response.status_code == 200
    record = await chat(client, agent, [files[2]["id"]], projects[0]["id"])
    chat_id = uuid.UUID(record["info"]["id"])
    async with sessions() as session:
        answer = MessageModel(
            user_id="a",
            chat_id=chat_id,
            role="assistant",
            content="Historical project A answer",
            parent_message_id=uuid.UUID(record["messages"][0]["id"]),
        )
        session.add(answer)
        await session.flush()
        root = await session.get(MessageModel, uuid.UUID(record["messages"][0]["id"]))
        root.active_child_id = answer.id
        await session.commit()
        before = [m.model_dump() for m in (await get_one(chat_id, "a", session)).messages]
        # Keep the same session/identity map across a move from another request.
        assert (await resolve_chat_file_scope(user_id="a", chat_id=chat_id, session=session)).project_id
        await session.commit()
        moved = await move(client, record, projects[1]["id"])
        assert moved.status_code == 200, moved.text
        assert moved.json()["project_id"] == projects[1]["id"]
        current = await resolve_chat_file_scope(user_id="a", chat_id=chat_id, session=session)
        assert current.project_system_prompt == "Instructions for B"
        assert set(map(str, current.allowed_file_ids)) == {files[1]["id"], files[2]["id"]}
        await session.commit()
    assert (await client.get(f"/chat/{chat_id}/files/{files[0]['id']}", headers=auth())).status_code == 404
    assert (await client.get(f"/chat/{chat_id}/files/{files[2]['id']}", headers=auth())).content == b"local.txt"
    moved_general = await move(client, record, None)
    assert moved_general.status_code == 200
    current = await scope(client, record)
    assert current["project_system_prompt"] == ""
    assert current["project_context_revision"] is None
    assert current["allowed_file_ids"] == [files[2]["id"]]
    async with sessions() as session:
        assert [m.model_dump() for m in (await get_one(chat_id, "a", session)).messages] == before
        assert len(list(await session.scalars(select(ChatFileModel)))) == 1
        assert len(list(await session.scalars(select(ProjectFileModel)))) == 2
    # Moving to the current scope is a successful no-op.
    assert (await move(client, record, None)).json() == moved_general.json()


@pytest.mark.asyncio
async def test_moves_reject_foreign_missing_invalid_and_active_runs(project_api):
    client, sessions, _ = project_api
    record = await chat(client, await seed_agent(sessions))
    foreign = (await client.post("/projects/", headers=auth("b"), json={"name": "Foreign"})).json()
    path = f"/chat/{record['info']['id']}/project"
    assert (await client.patch(path, json={"project_id": None})).status_code == 401
    assert (await client.patch(path, headers=auth(), json={})).status_code == 422
    assert (await client.patch(path, headers=auth(), json={"project_id": "invalid"})).status_code == 422
    for project_id in (foreign["id"], str(uuid.uuid4())):
        assert (await move(client, record, project_id)).status_code == 404
    assert (await move(client, record, None, "b")).status_code == 404
    project = await create(client)
    job = chat_jobs.get_or_create(uuid.UUID(record["info"]["id"]), SimpleNamespace(pending_approvals={}), user_id="a")
    task = job.start(asyncio.sleep(30))
    try:
        assert (await move(client, record, project["id"])).status_code == 409
        assert (await move(client, record, None, "b")).status_code == 404
        assert not task.done()
        assert (await scope(client, record))["project_id"] is None
        job.orchestrator.pending_approvals["approval"] = asyncio.get_running_loop().create_future()
        task.cancel()
        job.orchestrator.cancel_active_generation = lambda: asyncio.sleep(0)
        await task
        assert (await move(client, record, project["id"])).status_code == 409
        job.orchestrator.pending_approvals["approval"].set_result(False)
        assert (await move(client, record, project["id"])).status_code == 200
    finally:
        await chat_jobs.retire(uuid.UUID(record["info"]["id"]))


@pytest.mark.asyncio
async def test_turn_start_and_second_move_are_blocked_until_move_commits(project_api, monkeypatch):
    client, sessions, _ = project_api
    record = await chat(client, await seed_agent(sessions))
    project = await create(client)
    chat_id = uuid.UUID(record["info"]["id"])
    job = chat_jobs.get_or_create(chat_id, SimpleNamespace(pending_approvals={}), user_id="a")
    # Keep the job resident while the test exercises its start gate.
    admission = chat_jobs.admit_controller("a")
    chat_jobs.attach(chat_id, job, admission)
    entered, release = asyncio.Event(), asyncio.Event()
    async with sessions() as session:
        commit = session.commit

        async def held_commit():
            entered.set()
            await release.wait()
            await commit()

        monkeypatch.setattr(session, "commit", held_commit)
        moving = asyncio.create_task(
            move_chat(user_id="a", chat_id=chat_id, payload=ChatMoveRequest(project_id=project["id"]), session=session),
        )
        try:
            await asyncio.wait_for(entered.wait(), 5)
            with pytest.raises(CodedException) as error:
                job.start(asyncio.sleep(0))
            assert error.value.code == 409
            assert (await move(client, record, None)).status_code == 409
            release.set()
            assert (await moving).project_id == uuid.UUID(project["id"])
            await job.start(asyncio.sleep(0))
        finally:
            release.set()
            await moving
            admission.release()
            await chat_jobs.retire(chat_id)


@pytest.mark.asyncio
async def test_project_deletion_detaches_atomically_and_preserves_local_context(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    project = await create(client, system_prompt="Old prompt")
    agent = await seed_agent(sessions)
    local = await upload(client, "local.txt")
    records = [await chat(client, agent, [local["id"]], project["id"]) for _ in range(2)]
    path = f"/projects/{project['id']}"
    assert (await client.delete(path, headers=auth(), params={"expected_context_revision": 2})).status_code == 409
    from asterism.domains.chat import membership
    from asterism.domains.projects.service import delete_project

    detach = membership.detach_project_chats

    async def failing_detach(**kwargs):
        await detach(**kwargs)
        raise RuntimeError("Injected failure after detachment")

    with monkeypatch.context() as patch:
        patch.setattr(membership, "detach_project_chats", failing_detach)
        async with sessions() as session:
            with pytest.raises(RuntimeError, match="Injected failure"):
                await delete_project(
                    user_id="a",
                    project_id=uuid.UUID(project["id"]),
                    expected_context_revision=1,
                    session=session,
                )
    for record in records:
        assert (await scope(client, record))["project_id"] == project["id"]
    assert (await client.delete(path, headers=auth(), params={"expected_context_revision": 1})).status_code == 200
    for record in records:
        current = await scope(client, record)
        assert current["project_id"] is None
        assert current["project_system_prompt"] == ""
        assert current["allowed_file_ids"] == [local["id"]]
    async with sessions() as session:
        assert await session.get(ProjectModel, uuid.UUID(project["id"])) is None
        assert len(list(await session.scalars(select(MessageModel)))) == 2
        assert len(list(await session.scalars(select(ChatFileModel)))) == 2


@pytest.mark.asyncio
async def test_scoped_lists_and_http_search_paginate_after_filter_and_follow_moves(project_api):
    client, sessions, _ = project_api
    async with sessions() as session:
        async with session.bind.begin() as connection:
            await initialize_search_index(connection)
    projects = [await create(client, name=name, description="ocean analysis") for name in ("A", "B")]
    foreign_project = (await client.post("/projects/", headers=auth("b"), json={"name": "Ocean secret"})).json()
    async with sessions() as session:
        records = [
            ChatModel(user_id="a", title="Ocean notes", project_id=uuid.UUID(projects[0]["id"])),
            ChatModel(user_id="a", title="Ocean notes", project_id=uuid.UUID(projects[0]["id"])),
            ChatModel(user_id="a", title="Ocean notes", project_id=uuid.UUID(projects[1]["id"])),
            ChatModel(user_id="a", title="Ocean notes"),
            ChatModel(user_id="b", title="Ocean secret", project_id=uuid.UUID(foreign_project["id"])),
        ]
        session.add_all(records)
        await session.commit()
        ids = [str(record.id) for record in records]
    for path, params, expected in [
        ("/chat/", {}, {ids[3]}),
        ("/chat/", {"project_id": projects[0]["id"]}, set(ids[:2])),
        ("/chat/search", {"q": "ocean", "scope": "general"}, {ids[3]}),
        ("/chat/search", {"q": "ocean", "scope": "project", "project_id": projects[0]["id"]}, set(ids[:2])),
        ("/chat/search", {"q": "ocean"}, set(ids[:4]) | {project["id"] for project in projects}),
    ]:
        found = []
        for page in range(1, len(expected) + 2):
            response = await client.get(path, headers=auth(), params={**params, "page": page, "page_size": 1})
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["total"] == len(expected)
            found.extend(row["id"] for row in body.get("chats", body.get("results", [])))
        assert len(found) == len(set(found))
        assert set(found) == expected
    for path, params in [
        ("/chat/", {"project_id": foreign_project["id"]}),
        ("/chat/search", {"q": "ocean", "scope": "project", "project_id": foreign_project["id"]}),
    ]:
        assert (await client.get(path, headers=auth(), params=params)).status_code == 404
    missing_scope_id = await client.get("/chat/search", headers=auth(), params={"q": "ocean", "scope": "project"})
    assert missing_scope_id.status_code == 400
    assert (await client.get("/chat/", headers=auth(), params={"page": 0})).status_code == 422
    assert (await client.get("/chat/search", params={"q": "ocean"})).status_code == 401
    await move(client, {"info": {"id": ids[0]}}, None)
    general = (await client.get("/chat/search", headers=auth(), params={"q": "ocean", "scope": "general"})).json()
    assert {row["id"] for row in general["results"]} == {ids[0], ids[3]}
    assert all(row["project_name"] is None for row in general["results"])


def test_membership_openapi_contract():
    from asterism.main import app

    schema = app.openapi()
    move_schema = schema["components"]["schemas"]["ChatMoveRequest"]
    assert move_schema["required"] == ["project_id"]
    assert move_schema["additionalProperties"] is False
    assert {item["type"] for item in move_schema["properties"]["project_id"]["anyOf"]} == {"string", "null"}
    assert "409" in schema["paths"]["/chat/{chat_id}/project"]["patch"]["responses"]
    assert "folder_id" not in schema["components"]["schemas"]["SearchResult"]["properties"]
    assert "path" not in schema["components"]["schemas"]["SearchResult"]["properties"]
    assert {"chats", "total", "page", "page_size"} == set(schema["components"]["schemas"]["ChatInfoList"]["required"])
