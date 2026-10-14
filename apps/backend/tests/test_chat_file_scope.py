import uuid

import pytest
from asterism.core import config
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.chat.models import ChatFileModel, ChatModel, MessageModel
from asterism.domains.chat.schemas import NewMessageRequest, UpdateMessageRequest
from asterism.domains.chat.service import add_message, update_message
from asterism.domains.files.models import UserFileModel
from sqlalchemy import func, select
from test_projects_api import auth, create
from test_projects_api import project_api as _project_api

project_api = _project_api


async def seed_agent(sessions, user="a"):
    async with sessions() as session:
        agent = AgentProfileModel(user_id=user, name="Main", description="Scope test", tools=[], model_id=None)
        session.add(agent)
        await session.commit()
        return str(agent.id)


async def upload(client, name, user="a"):
    response = await client.post("/files/", headers=auth(user), files={"files": (name, name.encode(), "text/plain")})
    assert response.status_code == 201, response.text
    return response.json()["files"][0]


async def chat(client, agent, files=(), project=None, user="a"):
    response = await client.post(
        "/chat/",
        headers=auth(user),
        json={
            "agent_id": agent,
            "user_prompt": "Use these references",
            "files": list(files),
            "project_id": project,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def scope(client, chat_record):
    response = await client.get(f"/chat/{chat_record['info']['id']}/files/context", headers=auth())
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_project_and_general_scopes_do_not_grant_sibling_or_library_files(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    agent = await seed_agent(sessions)
    project = await create(client, system_prompt="Project task instructions")
    files = [
        await upload(client, name) for name in ("project.txt", "left.txt", "right.txt", "general.txt", "library.txt")
    ]
    await client.post(
        f"/projects/{project['id']}/files",
        headers=auth(),
        json={"file_ids": [files[0]["id"]], "expected_context_revision": 1},
    )
    left = await chat(client, agent, [files[1]["id"], files[0]["id"]], project["id"])
    right = await chat(client, agent, [files[2]["id"]], project["id"])
    general = await chat(client, agent, [files[3]["id"]])
    empty = await chat(client, agent)
    scopes = [await scope(client, record) for record in (left, right, general, empty)]
    assert [set(s["allowed_file_ids"]) for s in scopes] == [
        {files[0]["id"], files[1]["id"]},
        {files[0]["id"], files[2]["id"]},
        {files[3]["id"]},
        set(),
    ]
    assert scopes[0]["project_system_prompt"] == "Project task instructions"
    assert scopes[0]["project_context_revision"] == 2
    assert scopes[2]["project_system_prompt"] == scopes[3]["project_system_prompt"] == ""
    assert scopes[2]["project_id"] is None
    shared = next(file for file in scopes[0]["files"] if file["file_id"] == files[0]["id"])
    assert shared["sources"] == ["project", "chat"]
    assert shared["message_ids"] == [left["messages"][0]["id"]]
    assert {ref["file_id"] for ref in left["messages"][0]["files"]} == {files[0]["id"], files[1]["id"]}
    async with sessions() as session:
        assert len(list(await session.scalars(select(UserFileModel.id)))) == 5
        assert len(list(await session.scalars(select(ChatFileModel)))) == 4
    for foreign in (files[2], files[4]):
        for suffix in ("", "/info"):
            response = await client.get(f"/chat/{left['info']['id']}/files/{foreign['id']}{suffix}", headers=auth())
            assert response.status_code == 404
    assert (
        await client.get(f"/chat/{left['info']['id']}/files/{files[0]['id']}", headers=auth())
    ).content == b"project.txt"
    await client.request(
        "DELETE",
        f"/projects/{project['id']}/files",
        headers=auth(),
        json={"expected_context_revision": 2, "file_ids": [files[0]["id"]]},
    )
    assert (await scope(client, right))["allowed_file_ids"] == [files[2]["id"]]
    assert set((await scope(client, left))["allowed_file_ids"]) == {files[0]["id"], files[1]["id"]}
    assert (await client.get(f"/chat/{right['info']['id']}/files/{files[0]['id']}", headers=auth())).status_code == 404


@pytest.mark.asyncio
async def test_create_rejects_foreign_missing_duplicate_ids_atomically_and_old_contracts(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    agent = await seed_agent(sessions)
    owned, foreign = await upload(client, "owned.txt"), await upload(client, "foreign.txt", "b")
    foreign_project = (await client.post("/projects/", headers=auth("b"), json={"name": "Foreign"})).json()
    base = {"agent_id": agent, "user_prompt": "Test"}
    payloads = [
        ({"files": [owned["id"], foreign["id"]]}, 400),
        ({"files": [owned["id"], str(uuid.uuid4())]}, 400),
        ({"files": [owned["id"], owned["id"]]}, 400),
        ({"files": [owned["filename"]]}, 422),
        ({"folder_id": str(uuid.uuid4())}, 422),
        ({"project_id": foreign_project["id"]}, 404),
        ({"project_id": str(uuid.uuid4())}, 404),
    ]
    for fields, status in payloads:
        response = await client.post("/chat/", headers=auth(), json={**base, **fields})
        assert response.status_code == status, response.text
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ChatModel)) == 0
        assert await session.scalar(select(func.count()).select_from(MessageModel)) == 0
        assert await session.scalar(select(func.count()).select_from(ChatFileModel)) == 0
    record = await chat(client, agent, [owned["id"]])
    for path in (
        f"/chat/{record['info']['id']}/files/context",
        f"/chat/{record['info']['id']}/files/{owned['id']}",
        f"/chat/{record['info']['id']}/files/{owned['id']}/info",
    ):
        assert (await client.get(path)).status_code == 401
        assert (await client.get(path, headers=auth("b"))).status_code == 404
    assert (
        await client.patch(f"/chat/{record['info']['id']}", headers=auth(), json={"project_id": foreign_project["id"]})
    ).status_code == 422


@pytest.mark.asyncio
async def test_active_branch_is_the_only_source_of_chat_local_provenance(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    agent = await seed_agent(sessions)
    files = [await upload(client, name) for name in ("root.txt", "left.txt", "right.txt")]
    record = await chat(client, agent, [files[0]["id"]])
    chat_id, root_id = uuid.UUID(record["info"]["id"]), uuid.UUID(record["messages"][0]["id"])
    async with sessions() as session:
        children = [
            await add_message(
                "a",
                chat_id,
                NewMessageRequest(
                    role="user",
                    content=name,
                    parent_message_id=root_id,
                    model_id=uuid.uuid4(),
                    files=[uuid.UUID(file["id"])],
                ),
                session,
            )
            for name, file in zip(("left", "right"), files[1:], strict=True)
        ]
    assert set((await scope(client, record))["allowed_file_ids"]) == {files[0]["id"], files[2]["id"]}
    response = await client.patch(
        f"/chat/{chat_id}/message/{root_id}",
        headers=auth(),
        json={"active_child_id": str(children[0].id)},
    )
    assert response.status_code == 200, response.text
    current = await scope(client, record)
    assert set(current["allowed_file_ids"]) == {files[0]["id"], files[1]["id"]}
    assert files[2]["id"] not in current["unavailable_file_ids"]
    assert (await client.get(f"/chat/{chat_id}/files/{files[2]['id']}", headers=auth())).status_code == 404
    async with sessions() as session:
        assert len(list(await session.scalars(select(ChatFileModel)))) == 3
        foreign = ChatModel(user_id="a")
        session.add(foreign)
        await session.commit()
        foreign_parent = MessageModel(user_id="a", chat_id=foreign.id, role="user", content="other chat")
        session.add(foreign_parent)
        await session.commit()
        foreign_parent_id = foreign_parent.id
        with pytest.raises(NotFoundException):
            await add_message(
                "a",
                chat_id,
                NewMessageRequest(
                    role="user",
                    content="invalid",
                    model_id=uuid.uuid4(),
                    parent_message_id=foreign_parent_id,
                ),
                session,
            )
        await session.rollback()
        with pytest.raises(NotFoundException):
            await update_message(
                "a",
                chat_id,
                root_id,
                UpdateMessageRequest(active_child_id=foreign_parent_id),
                session,
            )
        await session.rollback()
    assert (
        await client.patch(f"/chat/{chat_id}/message/{root_id}", headers=auth(), json={"active_child_id": str(root_id)})
    ).status_code == 400
    await client.patch(f"/chat/{chat_id}/message/{root_id}", headers=auth(), json={"active_child_id": None})
    assert (await scope(client, record))["allowed_file_ids"] == [files[0]["id"]]


@pytest.mark.asyncio
async def test_source_deletion_preserves_history_and_never_substitutes_same_name(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    agent = await seed_agent(sessions)
    original = await upload(client, "same.txt")
    record = await chat(client, agent, [original["id"]])
    assert (await client.delete(f"/files/{original['filename']}", headers=auth())).status_code == 200
    replacement = await upload(client, "same.txt")
    assert replacement["id"] != original["id"]
    current = await scope(client, record)
    assert current["allowed_file_ids"] == []
    assert current["unavailable_file_ids"] == [original["id"]]
    assert (await client.get(f"/chat/{record['info']['id']}/files/{original['id']}", headers=auth())).status_code == 404
    async with sessions() as session:
        history = await session.get(MessageModel, uuid.UUID(record["messages"][0]["id"]))
        assert history.files[0].file_id == uuid.UUID(original["id"])
        assert await session.scalar(select(func.count()).select_from(ChatFileModel)) == 0


@pytest.mark.asyncio
async def test_followup_batch_rejection_does_not_bind_partial_files(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    agent = await seed_agent(sessions)
    owned, foreign = await upload(client, "owned.txt"), await upload(client, "foreign.txt", "b")
    record = await chat(client, agent)
    async with sessions() as session:
        with pytest.raises(BadDataException):
            await add_message(
                "a",
                uuid.UUID(record["info"]["id"]),
                NewMessageRequest(
                    role="user",
                    content="atomic",
                    model_id=uuid.uuid4(),
                    files=[uuid.UUID(owned["id"]), uuid.UUID(foreign["id"])],
                ),
                session,
            )
        await session.rollback()
        assert await session.scalar(select(func.count()).select_from(ChatFileModel)) == 0
        assert await session.scalar(select(func.count()).select_from(MessageModel)) == 1


@pytest.mark.asyncio
async def test_reopen_and_runtime_assembly_recheck_persisted_branch_and_deleted_ids(project_api, monkeypatch):
    from contextlib import asynccontextmanager
    from types import SimpleNamespace

    from asterism.domains.chat.orchestrator import ChatOrchestrator
    from asterism.domains.chat.service import get_one
    from asterism.domains.llm.schemas import text_content

    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    agent_id = await seed_agent(sessions)
    left, right = await upload(client, "left.txt"), await upload(client, "right.txt")
    record = await chat(client, agent_id)
    chat_id = uuid.UUID(record["info"]["id"])
    root_id = uuid.UUID(record["messages"][0]["id"])
    async with sessions() as session:
        children = [
            await add_message(
                "a",
                chat_id,
                NewMessageRequest(
                    role="user",
                    content="Read",
                    parent_message_id=root_id,
                    model_id=uuid.uuid4(),
                    files=[uuid.UUID(file["id"])],
                ),
                session,
            )
            for file in (left, right)
        ]
        reopened = await get_one(chat_id, "a", session)
    agent = SimpleNamespace(session=reopened, profile=SimpleNamespace(model_id=None))
    orchestrator = ChatOrchestrator(agent)

    @asynccontextmanager
    async def runtime_session():
        async with sessions() as session:
            yield session

    monkeypatch.setattr("asterism.domains.chat.orchestrator.get_async_db_session", runtime_session)
    assembled = await orchestrator._build_agent_messages()
    assert "### Attached file: right.txt\nright.txt" in text_content(assembled[-1])
    assert "left.txt" not in text_content(assembled[-1])
    await client.patch(
        f"/chat/{chat_id}/message/{root_id}",
        headers=auth(),
        json={"active_child_id": str(children[0].id)},
    )
    stale_assembly = await orchestrator._build_agent_messages()
    assert "no longer available" in text_content(stale_assembly[-1])
    assert "### Attached file" not in text_content(stale_assembly[-1])
    async with sessions() as session:
        orchestrator.chat = await get_one(chat_id, "a", session)
    current_assembly = await orchestrator._build_agent_messages()
    assert "### Attached file: left.txt\nleft.txt" in text_content(current_assembly[-1])
    await client.delete(f"/files/{left['filename']}", headers=auth())
    replacement = await upload(client, "left.txt")
    assert replacement["id"] != left["id"]
    async with sessions() as session:
        reopened = await get_one(chat_id, "a", session)
        assert reopened.messages[-1].files[0].file_id == uuid.UUID(left["id"])
        assert reopened.messages[-1].files[0].status == "failed"
    missing = await orchestrator._build_agent_messages()
    assert "no longer available" in text_content(missing[-1])
    assert "### Attached file" not in text_content(missing[-1])


@pytest.mark.asyncio
async def test_retained_snapshot_without_local_membership_does_not_grant_access(project_api, monkeypatch):
    from sqlalchemy import delete

    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    agent = await seed_agent(sessions)
    file = await upload(client, "revoked.txt")
    record = await chat(client, agent, [file["id"]])
    async with sessions() as session:
        await session.execute(delete(ChatFileModel).where(ChatFileModel.chat_id == uuid.UUID(record["info"]["id"])))
        await session.commit()
    current = await scope(client, record)
    assert current["allowed_file_ids"] == []
    assert current["unavailable_file_ids"] == [file["id"]]
    assert (
        await client.get(f"/chat/{record['info']['id']}/files/{file['id']}/info", headers=auth())
    ).status_code == 404
    async with sessions() as session:
        assert await session.get(UserFileModel, uuid.UUID(file["id"])) is not None
