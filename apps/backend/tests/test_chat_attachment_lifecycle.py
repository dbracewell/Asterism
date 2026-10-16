import asyncio
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from asterism.core import config
from asterism.domains.chat.draft_models import ChatDraftFileModel, ChatDraftModel, ChatSendReceiptModel
from asterism.domains.chat.models import ChatFileModel, ChatModel, MessageModel
from asterism.domains.chat.schemas import ChatSendRequest, MessageStatus, NewChatRequest
from asterism.domains.chat.sending import create_chat, send_message
from asterism.domains.files.models import UserFileModel
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from test_chat_file_scope import chat, scope, seed_agent, upload
from test_projects_api import auth, create
from test_projects_api import project_api as _project_api

project_api = _project_api


async def draft(client, chat_id=None, user="a"):
    response = await client.post("/chat/drafts", headers=auth(user), json={"chat_id": chat_id})
    assert response.status_code == 200, response.text
    return response.json()


async def stage(client, record, file_ids, user="a"):
    return await client.post(f"/chat/drafts/{record['id']}/files", headers=auth(user), json={"file_ids": file_ids})


async def complete_root(sessions, record):
    async with sessions() as session:
        await session.execute(
            update(MessageModel)
            .where(MessageModel.id == uuid.UUID(record["messages"][0]["id"]))
            .values(status=MessageStatus.COMPLETED),
        )
        await session.commit()


@pytest.mark.asyncio
async def test_new_draft_upload_and_library_pick_commit_only_to_accepted_chat(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    agent = await seed_agent(sessions)
    project = await create(client)
    staged = await draft(client)
    response = await client.post(
        f"/chat/drafts/{staged['id']}/uploads",
        headers=auth(),
        files={"files": ("upload.txt", b"original", "text/plain")},
    )
    assert response.status_code == 200, response.text
    uploaded = response.json()["files"][0]
    library = await upload(client, "picked.txt")
    assert (await stage(client, staged, [library["id"]])).status_code == 200
    assert (await stage(client, staged, [library["id"]])).status_code == 200  # duplicate selection is a no-op
    sibling = await chat(client, agent, project=project["id"])
    assert (await scope(client, sibling))["allowed_file_ids"] == []
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ChatFileModel)) == 0
    payload = {
        "model_id": "00000000-0000-0000-0000-000000000001",
        "request_id": str(uuid.uuid4()),
        "project_id": project["id"],
        "draft_id": staged["id"],
        "user_prompt": "Read both",
    }
    response = await client.post("/chat/", headers=auth(), json=payload)
    assert response.status_code == 200, response.text
    accepted = response.json()
    current = await scope(client, accepted)
    assert set(current["allowed_file_ids"]) == {uploaded["id"], library["id"]}
    assert all(file["sources"] == ["chat"] for file in current["files"])
    assert (await client.get(f"/chat/drafts/{staged['id']}", headers=auth())).status_code == 404
    replay = await client.post("/chat/", headers=auth(), json=payload)
    assert replay.status_code == 200 and replay.json() == accepted
    changed = await client.post("/chat/", headers=auth(), json={**payload, "user_prompt": "Different"})
    assert changed.status_code == 409
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ChatModel)) == 2
        assert await session.scalar(select(func.count()).select_from(ChatSendReceiptModel)) == 2
        assert await session.scalar(select(func.count()).select_from(ChatDraftFileModel)) == 0
    assert (
        await client.get(f"/chat/{accepted['info']['id']}/files/{uploaded['id']}", headers=auth())
    ).content == b"original"


@pytest.mark.asyncio
async def test_drafts_enforce_owner_target_and_whole_batch_validation(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    agent = await seed_agent(sessions)
    first, second = await chat(client, agent), await chat(client, agent)
    staged = await draft(client, first["info"]["id"])
    owned, foreign = await upload(client, "owned.txt"), await upload(client, "foreign.txt", "b")
    for ids, status in [
        ([owned["id"], foreign["id"]], 404),
        ([owned["id"], str(uuid.uuid4())], 404),
        ([owned["id"], owned["id"]], 400),
    ]:
        assert (await stage(client, staged, ids)).status_code == status
    assert (await stage(client, staged, [owned["id"]], "b")).status_code == 404
    assert (await client.get(f"/chat/drafts/{staged['id']}", headers=auth())).json()["file_ids"] == []
    await stage(client, staged, [owned["id"]])
    for target in (second, first):
        await complete_root(sessions, target)
    response = await client.post(
        f"/chat/{second['info']['id']}/message",
        headers=auth(),
        json={
            "expected_model_revision": 1,
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Wrong target",
            "draft_id": staged["id"],
            "parent_message_id": second["messages"][0]["id"],
        },
    )
    assert response.status_code == 400
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={
            "model_id": "00000000-0000-0000-0000-000000000001",
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Wrong new chat",
            "draft_id": staged["id"],
        },
    )
    assert response.status_code == 400
    assert (await scope(client, first))["allowed_file_ids"] == []
    assert (await scope(client, second))["allowed_file_ids"] == []
    assert (
        await client.post("/chat/drafts", headers=auth("b"), json={"chat_id": first["info"]["id"]})
    ).status_code == 404
    assert (await client.post("/chat/drafts", json={})).status_code == 401


@pytest.mark.asyncio
async def test_cancel_remove_and_expire_drafts_preserve_library_sources(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    file = await upload(client, "durable.txt")
    staged = await draft(client)
    await stage(client, staged, [file["id"]])
    removed = await client.request(
        "DELETE",
        f"/chat/drafts/{staged['id']}/files",
        headers=auth(),
        json={"file_ids": [file["id"]]},
    )
    assert removed.status_code == 200 and removed.json()["file_ids"] == []
    await stage(client, staged, [file["id"]])
    assert (await client.delete(f"/chat/drafts/{staged['id']}", headers=auth("b"))).status_code == 404
    assert (await client.delete(f"/chat/drafts/{staged['id']}", headers=auth())).status_code == 200
    expired = await draft(client)
    await stage(client, expired, [file["id"]])
    async with sessions() as session:
        await session.execute(
            update(ChatDraftModel).where(ChatDraftModel.id == uuid.UUID(expired["id"])).values(expires_at=1),
        )
        await session.commit()
    assert (await stage(client, expired, [file["id"]])).status_code == 404
    assert (
        await client.post(
            f"/chat/drafts/{expired['id']}/uploads",
            headers=auth(),
            files={"files": ("never.txt", b"never", "text/plain")},
        )
    ).status_code == 404
    await draft(client)  # owner-scoped lazy expiry cleanup
    async with sessions() as session:
        assert await session.get(ChatDraftModel, uuid.UUID(expired["id"])) is None
        assert await session.scalar(select(func.count()).select_from(ChatDraftFileModel)) == 0
        assert await session.scalar(select(func.count()).select_from(UserFileModel)) == 1
        assert await session.scalar(select(func.count()).select_from(ChatFileModel)) == 0
    assert (await client.get(f"/files/{file['filename']}", headers=auth())).content == b"durable.txt"


@pytest.mark.asyncio
async def test_upload_failure_and_failed_send_leave_draft_retryable_and_no_partial_bindings(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    monkeypatch.setattr(config, "max_upload_file_size_bytes", 4)
    staged = await draft(client)
    response = await client.post(
        f"/chat/drafts/{staged['id']}/uploads",
        headers=auth(),
        files=[("files", ("small.txt", b"ok", "text/plain")), ("files", ("large.txt", b"too large", "text/plain"))],
    )
    assert response.status_code == 400
    assert (await client.get(f"/chat/drafts/{staged['id']}", headers=auth())).json()["file_ids"] == []
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(UserFileModel)) == 0
    monkeypatch.setattr(config, "max_upload_file_size_bytes", 1000)
    file = await upload(client, "retry.txt")
    await stage(client, staged, [file["id"]])
    await seed_agent(sessions)
    payload = NewChatRequest(
        model_id=uuid.UUID(int=1),
        request_id=uuid.uuid4(),
        user_prompt="Atomic",
        draft_id=staged["id"],
    )
    async with sessions() as session:

        async def failing_commit():
            raise RuntimeError("Injected commit failure")

        with monkeypatch.context() as patch:
            patch.setattr(session, "commit", failing_commit)
            with pytest.raises(RuntimeError, match="Injected commit"):
                await create_chat("a", payload, session)
        assert await session.scalar(select(func.count()).select_from(ChatFileModel)) == 0
        assert await session.scalar(select(func.count()).select_from(MessageModel)) == 0
        assert await session.scalar(select(func.count()).select_from(ChatSendReceiptModel)) == 0
        assert await session.get(ChatDraftModel, uuid.UUID(staged["id"])) is not None
        accepted = await create_chat("a", payload, session)
        assert [f.file_id for f in accepted.messages[0].files] == [uuid.UUID(file["id"])]


@pytest.mark.asyncio
async def test_followup_receipts_guard_branch_active_runs_and_atomic_draft_consumption(project_api, monkeypatch):
    from asterism.domains.chat.jobs import chat_jobs

    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    record = await chat(client, await seed_agent(sessions))
    await complete_root(sessions, record)
    file = await upload(client, "followup.txt")
    staged = await draft(client, record["info"]["id"])
    await stage(client, staged, [file["id"]])
    payload = {
        "expected_model_revision": 1,
        "request_id": str(uuid.uuid4()),
        "user_prompt": "Read",
        "parent_message_id": record["messages"][0]["id"],
        "draft_id": staged["id"],
    }
    path = f"/chat/{record['info']['id']}/message"
    assert (
        await client.post(path, headers=auth(), json={**payload, "parent_message_id": str(uuid.uuid4())})
    ).status_code == 409
    job = chat_jobs.get_or_create(
        uuid.UUID(record["info"]["id"]),
        SimpleNamespace(
            pending_approvals={},
            cancel_active_generation=lambda: asyncio.sleep(0),
        ),
    )
    chat_jobs.attach(uuid.UUID(record["info"]["id"]), job)
    task = job.start(asyncio.sleep(30))
    try:
        assert (await client.post(path, headers=auth(), json=payload)).status_code == 409
        assert (await client.post(path, headers=auth("b"), json=payload)).status_code == 404
        assert (await scope(client, record))["allowed_file_ids"] == []
        task.cancel()
        await task
        accepted = await client.post(path, headers=auth(), json=payload)
        assert accepted.status_code == 200, accepted.text
        task = job.start(asyncio.sleep(30))
        replay = await client.post(path, headers=auth(), json=payload)
        assert replay.status_code == 200 and replay.json()["id"] == accepted.json()["id"]
        assert (await client.post(path, headers=auth(), json={**payload, "user_prompt": "Changed"})).status_code == 409
        assert (
            await client.delete(f"/chat/{record['info']['id']}/files/{file['id']}", headers=auth())
        ).status_code == 409
    finally:
        await chat_jobs.retire(uuid.UUID(record["info"]["id"]))
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(MessageModel)) == 2
        assert await session.get(ChatDraftModel, uuid.UUID(staged["id"])) is None
    assert (await scope(client, record))["allowed_file_ids"] == [file["id"]]


@pytest.mark.asyncio
async def test_removal_revokes_local_access_and_keeps_history_sources_and_project_memberships(project_api, monkeypatch):
    from asterism.domains.chat.service import get_one

    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    agent = await seed_agent(sessions)
    file = await upload(client, "history.txt")
    first, sibling = await chat(client, agent, [file["id"]]), await chat(client, agent, [file["id"]])
    path = f"/chat/{first['info']['id']}/files/{file['id']}"
    assert (await client.delete(path, headers=auth("b"))).status_code == 404
    removed = await client.delete(path, headers=auth())
    assert removed.status_code == 200
    assert removed.json()["allowed_file_ids"] == []
    assert removed.json()["unavailable_file_ids"] == [file["id"]]
    assert (await client.delete(path, headers=auth())).status_code == 200
    assert (await client.get(path, headers=auth())).status_code == 404
    assert (await scope(client, sibling))["allowed_file_ids"] == [file["id"]]
    async with sessions() as session:
        reopened = await get_one(uuid.UUID(first["info"]["id"]), "a", session)
        assert reopened.messages[0].files[0].available is False
        snapshot = await session.get(MessageModel, reopened.messages[0].id)
        assert snapshot.files[0].file_id == uuid.UUID(file["id"])
        assert snapshot.files[0].available is True  # availability is response-only, not rewritten history
    assert (await client.get(f"/files/{file['filename']}", headers=auth())).content == b"history.txt"
    project = await create(client)
    await client.post(
        f"/projects/{project['id']}/files",
        headers=auth(),
        json={"file_ids": [file["id"]], "expected_context_revision": 1},
    )
    project_chat = await chat(client, agent, [file["id"]], project["id"])
    removed = await client.delete(f"/chat/{project_chat['info']['id']}/files/{file['id']}", headers=auth())
    assert removed.json()["allowed_file_ids"] == [file["id"]]
    assert removed.json()["unavailable_file_ids"] == []
    assert removed.json()["files"][0]["sources"] == ["project"]


@pytest.mark.asyncio
async def test_same_request_concurrent_create_has_one_message_and_receipt(project_api):
    client, sessions, _ = project_api
    await seed_agent(sessions)
    payload = {
        "model_id": "00000000-0000-0000-0000-000000000001",
        "request_id": str(uuid.uuid4()),
        "user_prompt": "Exactly once",
    }
    responses = await asyncio.gather(*[client.post("/chat/", headers=auth(), json=payload) for _ in range(2)])
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ChatModel)) == 1
        assert await session.scalar(select(func.count()).select_from(MessageModel)) == 1
        assert await session.scalar(select(func.count()).select_from(ChatSendReceiptModel)) == 1


@pytest.mark.asyncio
async def test_database_rejects_foreign_draft_and_receipt_links(project_api):
    client, sessions, _ = project_api
    agent = await seed_agent(sessions)
    record = await chat(client, agent)
    staged = await draft(client)
    async with sessions() as session:
        session.add(ChatDraftModel(user_id="b", chat_id=uuid.UUID(record["info"]["id"]), expires_at=9999999999))
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()
        session.add(
            ChatSendReceiptModel(
                user_id="b",
                request_id=uuid.uuid4(),
                chat_id=uuid.UUID(record["info"]["id"]),
                message_id=uuid.UUID(record["messages"][0]["id"]),
                fingerprint="a" * 64,
            ),
        )
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()
        session.add(ChatDraftFileModel(user_id="b", draft_id=uuid.UUID(staged["id"]), file_id=uuid.uuid4()))
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()


@pytest.mark.asyncio
async def test_deleted_draft_source_is_removed_before_send_and_never_retargeted(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    file = await upload(client, "same.txt")
    staged = await draft(client)
    await stage(client, staged, [file["id"]])
    await client.delete(f"/files/{file['filename']}", headers=auth())
    replacement = await upload(client, "same.txt")
    assert replacement["id"] != file["id"]
    missing = (await client.get(f"/chat/drafts/{staged['id']}", headers=auth())).json()
    assert missing["file_ids"] == missing["unavailable_file_ids"] == [file["id"]]
    await seed_agent(sessions)
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={
            "model_id": "00000000-0000-0000-0000-000000000001",
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Continue",
            "draft_id": staged["id"],
        },
    )
    assert response.status_code == 400  # Never silently accept an incomplete staged set.
    await client.request(
        "DELETE",
        f"/chat/drafts/{staged['id']}/files",
        headers=auth(),
        json={"file_ids": [file["id"]]},
    )
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={
            "model_id": "00000000-0000-0000-0000-000000000001",
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Continue",
            "draft_id": staged["id"],
        },
    )
    assert response.status_code == 200
    assert response.json()["messages"][0]["files"] == []


@pytest.mark.asyncio
async def test_cancelled_upload_rolls_back_metadata_and_removes_uncommitted_bytes(project_api, monkeypatch):
    from asterism.domains.files.service import upload_files

    _, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)

    async def read_ok(size):
        return b"saved before cancellation"

    async def read_cancelled(size):
        raise asyncio.CancelledError()

    async with sessions() as session:
        with pytest.raises(asyncio.CancelledError):
            await upload_files(
                user_id="a",
                uploads=[
                    SimpleNamespace(filename="first.txt", read=read_ok),
                    SimpleNamespace(filename="second.txt", read=read_cancelled),
                ],
                session=session,
            )
        assert await session.scalar(select(func.count()).select_from(UserFileModel)) == 0
    assert list(tmp_path.rglob("source.*")) == []


@pytest.mark.asyncio
async def test_cancelled_send_releases_guard_and_retains_retryable_draft(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    record = await chat(client, await seed_agent(sessions))
    await complete_root(sessions, record)
    staged = await draft(client, record["info"]["id"])
    file = await upload(client, "cancel.txt")
    await stage(client, staged, [file["id"]])
    payload = ChatSendRequest(
        expected_model_revision=1,
        request_id=uuid.uuid4(),
        user_prompt="Read",
        draft_id=staged["id"],
        parent_message_id=record["messages"][0]["id"],
    )
    async with sessions() as session:

        async def cancelled_commit():
            raise asyncio.CancelledError()

        with monkeypatch.context() as patch:
            patch.setattr(session, "commit", cancelled_commit)
            with pytest.raises(asyncio.CancelledError):
                await send_message(
                    user_id="a",
                    chat_id=uuid.UUID(record["info"]["id"]),
                    payload=payload,
                    session=session,
                )
        assert await session.scalar(select(func.count()).select_from(MessageModel)) == 1
        assert await session.scalar(select(func.count()).select_from(ChatFileModel)) == 0
        assert await session.get(ChatDraftModel, uuid.UUID(staged["id"])) is not None
        accepted = await send_message(
            user_id="a",
            chat_id=uuid.UUID(record["info"]["id"]),
            payload=payload,
            session=session,
        )
        assert [ref.file_id for ref in accepted.files] == [uuid.UUID(file["id"])]


@pytest.mark.asyncio
async def test_reopen_regenerate_and_revocation_use_current_memberships(project_api, monkeypatch):
    from asterism.domains.chat.orchestrator import ChatOrchestrator
    from asterism.domains.chat.service import get_one
    from asterism.domains.llm.schemas import text_content

    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    record = await chat(client, await seed_agent(sessions))
    await complete_root(sessions, record)
    file = await upload(client, "resume.txt")
    payload = {
        "expected_model_revision": 1,
        "request_id": str(uuid.uuid4()),
        "user_prompt": "Read",
        "files": [file["id"]],
        "parent_message_id": record["messages"][0]["id"],
    }
    response = await client.post(f"/chat/{record['info']['id']}/message", headers=auth(), json=payload)
    assert response.status_code == 200
    async with sessions() as session:
        reopened = await get_one(uuid.UUID(record["info"]["id"]), "a", session)
    from asterism.core.schemas import AuthedUser
    from asterism.domains.agent.agent import Agent
    from asterism.domains.agent.service import get_main_agent_profile

    agent = Agent(
        profile=await get_main_agent_profile("a"),
        user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
        session=reopened,
        model_id=reopened.info.selected_model_id,
    )
    orchestrator = ChatOrchestrator(agent)

    calls = []

    async def run_agent():
        await agent.prepare_execution(orchestrator.chat.messages[-1].id)
        await agent.prepare_execution_scope()
        calls.append(await orchestrator._build_agent_messages())

    monkeypatch.setattr(orchestrator, "run_agent", run_agent)
    await orchestrator.resume_pending_turn()
    assert "### Attached file: resume.txt" in text_content(calls[-1][-1])
    parent_index, _ = orchestrator.find_message(response.json()["id"])
    await orchestrator.handle_regenerate_message(parent_index)
    assert "### Attached file: resume.txt" in text_content(calls[-1][-1])
    await client.delete(f"/chat/{record['info']['id']}/files/{file['id']}", headers=auth())
    await orchestrator.resume_pending_turn()
    assert "no longer available" in text_content(calls[-1][-1])
    assert "### Attached file" not in text_content(calls[-1][-1])
    replay = await client.post(f"/chat/{record['info']['id']}/message", headers=auth(), json=payload)
    assert replay.status_code == 200
    assert replay.json()["files"][0]["available"] is False
    assert (await scope(client, record))["allowed_file_ids"] == []  # replay cannot reattach a removed file


@pytest.mark.asyncio
async def test_generation_cancel_keeps_attachments_without_replay_restart(project_api, monkeypatch):
    from asterism.domains.chat.orchestrator import ChatOrchestrator
    from asterism.domains.chat.service import get_one

    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    file = await upload(client, "cancel-generation.txt")
    await seed_agent(sessions)
    payload = {
        "model_id": "00000000-0000-0000-0000-000000000001",
        "request_id": str(uuid.uuid4()),
        "user_prompt": "Read",
        "files": [file["id"]],
    }
    record = (await client.post("/chat/", headers=auth(), json=payload)).json()
    async with sessions() as session:
        reopened = await get_one(uuid.UUID(record["info"]["id"]), "a", session)
    orchestrator = ChatOrchestrator(
        SimpleNamespace(
            session=reopened,
            model_id=None,
            prepare_execution=AsyncMock(return_value=None),
            refresh_main_configuration=AsyncMock(),
        ),
    )

    @asynccontextmanager
    async def runtime_session(session=None):
        async with sessions() as db:
            yield db

    monkeypatch.setattr("asterism.domains.chat.service.get_async_db_session", runtime_session)
    orchestrator._active_parent_id = reopened.messages[0].id
    await orchestrator.cancel_active_generation()
    replay = await client.post("/chat/", headers=auth(), json=payload)
    assert replay.status_code == 200
    assert replay.json()["messages"][0]["status"] == "cancelled"
    assert replay.json()["messages"][0]["files"][0]["available"] is True
    await orchestrator.resume_pending_turn()  # no pending turn; must never call a provider
    assert (await scope(client, record))["allowed_file_ids"] == [file["id"]]
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(MessageModel)) == 1


@pytest.mark.asyncio
async def test_dispatch_failure_preserves_source_and_collision_retry_reuses_id(project_api, monkeypatch):
    from io import BytesIO

    from asterism.domains.files.service import upload_files
    from fastapi import UploadFile

    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    original = await upload(client, "collision.txt")
    async with sessions() as session:

        def fail_dispatch(**kwargs):
            raise RuntimeError("Dispatch unavailable")

        with monkeypatch.context() as patch:
            patch.setattr("asterism.domains.extraction.runtime.start_file_ingestion_job", fail_dispatch)
            with pytest.raises(RuntimeError, match="Dispatch unavailable"):
                await upload_files(
                    user_id="a",
                    uploads=[UploadFile(filename="collision.txt", file=BytesIO(b"different"))],
                    session=session,
                )
        records = list(await session.scalars(select(UserFileModel).where(UserFileModel.user_id == "a")))
        assert len(records) == 2
        retained = next(row for row in records if str(row.id) != original["id"])
        from asterism.domains.files.store import get_file_store

        assert get_file_store().open("a", retained.storage_key).read_bytes() == b"different"
        retry = await upload_files(
            user_id="a",
            uploads=[UploadFile(filename="collision.txt", file=BytesIO(b"different"))],
            session=session,
        )
        assert retry.files[0].id == retained.id
        assert await session.scalar(select(func.count()).select_from(UserFileModel)) == 2


@pytest.mark.asyncio
async def test_discard_during_upload_preserves_source_without_any_chat_access(project_api, monkeypatch):
    from asterism.domains.files import service as files_service

    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    staged = await draft(client)
    ingest = files_service.upload_files

    async def ingest_then_discard(**kwargs):
        result = await ingest(**kwargs)
        assert (await client.delete(f"/chat/drafts/{staged['id']}", headers=auth())).status_code == 200
        return result

    monkeypatch.setattr(files_service, "upload_files", ingest_then_discard)
    response = await client.post(
        f"/chat/drafts/{staged['id']}/uploads",
        headers=auth(),
        files={"files": ("cancelled-draft.txt", b"durable source", "text/plain")},
    )
    assert response.status_code == 404
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(UserFileModel)) == 1
        assert await session.scalar(select(func.count()).select_from(ChatDraftFileModel)) == 0
        assert await session.scalar(select(func.count()).select_from(ChatFileModel)) == 0


def test_openapi_exposes_drafts_explicit_send_keys_and_source_availability():
    from asterism.main import app

    schema = app.openapi()
    assert "request_id" in schema["components"]["schemas"]["NewChatRequest"]["required"]
    assert {"request_id", "user_prompt", "parent_message_id"} <= set(
        schema["components"]["schemas"]["ChatSendRequest"]["required"],
    )
    assert "available" in schema["components"]["schemas"]["MessageFileReference"]["properties"]
    assert "unavailable_file_ids" in schema["components"]["schemas"]["ChatDraft"]["required"]
    assert "409" in schema["paths"]["/chat/{chat_id}/message"]["post"]["responses"]
    assert "409" in schema["paths"]["/chat/{chat_id}/files/{file_id}"]["delete"]["responses"]


@pytest.mark.asyncio
async def test_draft_snapshot_cannot_restore_revoked_membership(project_api, monkeypatch):
    from sqlalchemy import delete

    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    file = await upload(client, "revoked-draft.txt")
    staged = await draft(client)
    await stage(client, staged, [file["id"]])
    async with sessions() as session:
        await session.execute(delete(ChatDraftFileModel).where(ChatDraftFileModel.draft_id == uuid.UUID(staged["id"])))
        await session.commit()
    await seed_agent(sessions)
    payload = {
        "model_id": "00000000-0000-0000-0000-000000000001",
        "request_id": str(uuid.uuid4()),
        "user_prompt": "Read",
        "draft_id": staged["id"],
    }
    assert (await client.post("/chat/", headers=auth(), json=payload)).status_code == 400
    current = (await client.get(f"/chat/drafts/{staged['id']}", headers=auth())).json()
    assert current["unavailable_file_ids"] == [file["id"]]
    assert (await stage(client, staged, [file["id"]])).status_code == 200  # deliberate owned re-selection
    assert (await client.post("/chat/", headers=auth(), json=payload)).status_code == 200
