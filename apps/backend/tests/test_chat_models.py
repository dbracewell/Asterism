import asyncio
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from asterism.core.exceptions import CodedException
from asterism.domains.agent.schemas import MainAgentUpdate, SubAgentCreate
from asterism.domains.agent.service import get_main_agent_profile, save_sub_agent, update_main_agent
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.jobs import chat_jobs
from asterism.domains.chat.model_selection import change_chat_model
from asterism.domains.chat.models import ChatModel, MessageModel
from asterism.domains.chat.schemas import ChatModelUpdate, ChatSendRequest, MessageStatus, NewMessageRequest
from asterism.domains.chat.sending import send_message
from asterism.domains.chat.service import add_message, get_one
from asterism.domains.settings.models import LLMModel
from sqlalchemy import delete, update
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
A, B = str(uuid.UUID(int=1)), str(uuid.UUID(int=2))


async def new_chat(client, **extra):
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={"request_id": str(uuid.uuid4()), "user_prompt": "Hello", "model_id": A, **extra},
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_explicit_choice_reopen_owner_revision_and_no_default_retargeting(project_api):
    client, sessions, _ = project_api
    assert (
        await client.post(
            "/chat/",
            headers=auth(),
            json={"request_id": str(uuid.uuid4()), "user_prompt": "Missing choice"},
        )
    ).status_code == 422
    assert (
        await client.post(
            "/chat/",
            headers=auth(),
            json={"request_id": str(uuid.uuid4()), "user_prompt": "Bad choice", "model_id": str(uuid.uuid4())},
        )
    ).status_code == 409
    choices = (await client.get("/chat/models", headers=auth())).json()
    assert {choice["id"] for choice in choices} == {A, B}
    assert all(choice["available"] for choice in choices)
    assert not any("api_key" in choice for choice in choices)
    chat = await new_chat(client)
    path = f"/chat/{chat['info']['id']}/model"
    assert chat["info"]["selected_model_id"] == A
    before_messages = (await client.get(f"/chat/{chat['info']['id']}", headers=auth())).json()["messages"]
    main = (await client.get("/settings/user/main-agent", headers=auth())).json()
    await client.put("/settings/user/default_model_id", headers=auth(), json={"value": B})
    assert (await client.get(f"/chat/{chat['info']['id']}", headers=auth())).json()["info"]["selected_model_id"] == A
    payload = {"model_id": B, "expected_model_revision": 1}
    assert (await client.put(path, headers=auth("b"), json=payload)).status_code == 404
    changed = await client.put(path, headers=auth(), json=payload)
    assert changed.status_code == 200, changed.text
    assert changed.json()["model_revision"] == 2
    assert (await client.put(path, headers=auth(), json=payload)).status_code == 409
    reopened = (await client.get(f"/chat/{chat['info']['id']}", headers=auth())).json()
    assert reopened["info"]["selected_model"]["id"] == B
    assert reopened["info"]["context_model"]["id"] == B
    assert reopened["messages"] == before_messages
    assert (await client.get("/settings/user/main-agent", headers=auth())).json() == main


@pytest.mark.asyncio
async def test_disabled_deleted_selection_remains_readable_without_fallback(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client)
    async with sessions() as session:
        await session.execute(update(LLMModel).where(LLMModel.id == uuid.UUID(A)).values(is_active=False))
        await session.commit()
    for deleted in (False, True):
        if deleted:
            async with sessions() as session:
                await session.execute(delete(LLMModel).where(LLMModel.id == uuid.UUID(A)))
                await session.commit()
        info = (await client.get(f"/chat/{chat['info']['id']}", headers=auth())).json()["info"]
        assert info["selected_model_id"] == A
        assert info["selected_model"]["name"] == "Chat A"
        assert info["selected_model"]["available"] is False
        assert info["context_model"] is None
        assert (
            await client.put(
                f"/chat/{chat['info']['id']}/model",
                headers=auth(),
                json={"model_id": A, "expected_model_revision": 1},
            )
        ).status_code == 409
    async with sessions() as session:
        await session.execute(update(LLMModel).values(is_active=False))
        await session.commit()
    assert not any(choice["available"] for choice in (await client.get("/chat/models", headers=auth())).json())


@pytest.mark.asyncio
async def test_draft_selection_validation_and_atomic_consumption(project_api):
    client, _, _ = project_api
    draft = (await client.post("/chat/drafts", headers=auth(), json={"model_id": A})).json()
    path = f"/chat/drafts/{draft['id']}/model"
    assert draft["model_id"] == A
    assert (await client.put(path, headers=auth("b"), json={"model_id": B, "expected_model_id": A})).status_code == 404
    assert (await client.put(path, headers=auth(), json={"model_id": B, "expected_model_id": None})).status_code == 409
    assert (await client.put(path, headers=auth(), json={"model_id": B, "expected_model_id": A})).json()[
        "model_id"
    ] == B
    body = {"request_id": str(uuid.uuid4()), "user_prompt": "Draft", "model_id": A, "draft_id": draft["id"]}
    assert (await client.post("/chat/", headers=auth(), json=body)).status_code == 409
    assert (await client.get(f"/chat/drafts/{draft['id']}", headers=auth())).status_code == 200
    body["model_id"] = B
    assert (await client.post("/chat/", headers=auth(), json=body)).json()["info"]["selected_model_id"] == B
    assert (await client.get(f"/chat/drafts/{draft['id']}", headers=auth())).status_code == 404


@pytest.mark.asyncio
async def test_execution_snapshot_resume_regeneration_history_and_fixed_worker(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client)
    chat_id, parent_id = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as session:
        original = await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent_id, session=session)
        main = await update_main_agent("a", MainAgentUpdate(system_prompt="New instructions", max_steps=9), session)
        assert main.config_revision > original.configuration.config_revision
        worker = await save_sub_agent("a", SubAgentCreate(name="Fixed worker", model_id=uuid.UUID(A)), session=session)
        await change_chat_model(
            user_id="a",
            chat_id=chat_id,
            payload=ChatModelUpdate(model_id=uuid.UUID(B), expected_model_revision=1),
            session=session,
        )
        replay = await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent_id, session=session)
        assert replay == original
        reopened = await get_one(chat_id, "a", session)
        assert reopened.info.selected_model_id == uuid.UUID(B)
        assert reopened.info.context_model.id == uuid.UUID(A)
        assert reopened.info.pending_execution.id == original.id
        await session.commit()
        async with sessions() as resumed_session:
            resumed = await prepare_execution(
                user_id="a",
                chat_id=chat_id,
                message_id=parent_id,
                session=resumed_session,
            )
            assert resumed == original
        answer = await add_message(
            "a",
            chat_id,
            NewMessageRequest(
                model_id=original.model.id,
                role="assistant",
                content="Original answer",
                parent_message_id=parent_id,
                execution=original,
            ),
            session,
        )
        regenerated = await prepare_execution(
            user_id="a",
            chat_id=chat_id,
            message_id=parent_id,
            restart=True,
            session=session,
        )
        assert regenerated.id != original.id and regenerated.model.id == uuid.UUID(B)
        assert regenerated.configuration.system_prompt == "New instructions"
        assert regenerated.configuration.config_revision == main.config_revision
        assert (await get_main_agent_profile("a", session)).model_id is None
        assert (await session.get(MessageModel, answer.id)).execution == original
        assert worker.model_id == uuid.UUID(A)
        assert (await session.get(ChatModel, chat_id)).selected_model_id == uuid.UUID(B)


@pytest.mark.asyncio
async def test_recorded_model_revocation_rejects_resume_but_allows_explicit_regeneration(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client)
    chat_id, parent = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as session:
        original = await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent, session=session)
        await change_chat_model(
            user_id="a",
            chat_id=chat_id,
            payload=ChatModelUpdate(model_id=uuid.UUID(B), expected_model_revision=1),
            session=session,
        )
        await session.execute(update(LLMModel).where(LLMModel.id == original.model.id).values(is_active=False))
        await session.commit()
        with pytest.raises(CodedException, match="unavailable"):
            await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent, session=session)
        reopened = await get_one(chat_id, "a", session)
        assert reopened.info.resume_error and reopened.info.context_model is None
        fresh = await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent, restart=True, session=session)
        assert fresh.model.id == uuid.UUID(B)


@pytest.mark.asyncio
async def test_active_run_rejects_model_change_and_stale_send_but_replays_acknowledgement(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client)
    chat_id, parent = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    job = chat_jobs.get_or_create(
        chat_id, SimpleNamespace(pending_approvals={}, cancel_active_generation=AsyncMock()), user_id="a"
    )
    blocker = asyncio.Event()
    job.start(blocker.wait())
    try:
        assert (
            await client.put(
                f"/chat/{chat_id}/model",
                headers=auth(),
                json={"model_id": B, "expected_model_revision": 1},
            )
        ).status_code == 409
    finally:
        blocker.set()
        await job.task
        await chat_jobs.retire(chat_id)
    async with sessions() as session:
        row = await session.get(MessageModel, parent)
        row.status = MessageStatus.COMPLETED
        await session.commit()
        payload = ChatSendRequest(
            request_id=uuid.uuid4(),
            user_prompt="Next",
            parent_message_id=parent,
            expected_model_revision=1,
        )
        accepted = await send_message(user_id="a", chat_id=chat_id, payload=payload, session=session)
        await change_chat_model(
            user_id="a",
            chat_id=chat_id,
            payload=ChatModelUpdate(model_id=uuid.UUID(B), expected_model_revision=1),
            session=session,
        )
        assert (await send_message(user_id="a", chat_id=chat_id, payload=payload, session=session)).id == accepted.id
        with pytest.raises(CodedException, match="selection changed"):
            await send_message(
                user_id="a",
                chat_id=chat_id,
                payload=payload.model_copy(update={"request_id": uuid.uuid4()}),
                session=session,
            )


@pytest.mark.asyncio
async def test_runtime_persists_actual_execution_and_streams_its_identity(project_api, monkeypatch):
    from asterism.core.schemas import AuthedUser
    from asterism.domains.agent.agent import Agent
    from asterism.domains.agent.schemas import AgentEvent, AgentEventType
    from asterism.domains.chat.orchestrator import ChatOrchestrator

    client, sessions, _ = project_api
    chat = await new_chat(client)
    chat_id = uuid.UUID(chat["info"]["id"])
    async with sessions() as session:
        await change_chat_model(
            user_id="a",
            chat_id=chat_id,
            payload=ChatModelUpdate(model_id=uuid.UUID(B), expected_model_revision=1),
            session=session,
        )
        opened = await get_one(chat_id, "a", session)
        profile = await get_main_agent_profile("a", session)
    agent = Agent(
        profile=profile,
        user=AuthedUser(id="a", name="A", email="a@example.test", role="user"),
        session=opened,
        model_id=uuid.UUID(A),
    )

    @asynccontextmanager
    async def database(supplied=None):
        if supplied is not None:
            yield supplied
        else:
            async with sessions() as session:
                yield session

    for domain in ["execution", "service"]:
        monkeypatch.setattr(f"asterism.domains.chat.{domain}.get_async_db_session", database)
    monkeypatch.setattr("asterism.db.database.get_async_db_session", database)

    executing = uuid.UUID(B)

    async def generate(*, messages):
        assert agent.model_id == executing
        assert agent.execution.model.id == executing
        yield AgentEvent(type=AgentEventType.START)
        yield AgentEvent(type=AgentEventType.COMPLETE, content="Executed B")

    monkeypatch.setattr(agent, "run", generate)
    runtime = ChatOrchestrator(agent)
    await runtime.run_agent()
    packets = []
    while not runtime.queue.empty():
        packets.append(await runtime.queue.get())
    assert next(packet for packet in packets if packet["type"] == "start")["execution"]["model"]["id"] == B
    async with sessions() as session:
        result = await get_one(chat_id, "a", session)
    assert result.messages[-1].execution.model.id == uuid.UUID(B)
    assert result.messages[-1].model_id == uuid.UUID(B)
    assert result.messages[-1].execution.model_revision == 2

    original = result.messages[-1]
    async with sessions() as session:
        await update_main_agent("a", MainAgentUpdate(system_prompt="Regenerated instructions"), session)
        await change_chat_model(
            user_id="a",
            chat_id=chat_id,
            payload=ChatModelUpdate(model_id=uuid.UUID(A), expected_model_revision=2),
            session=session,
        )
    executing = uuid.UUID(A)
    await runtime.handle_regenerate_message(len(runtime.chat.messages) - 1)
    async with sessions() as session:
        regenerated = await get_one(chat_id, "a", session)
        historical = await session.get(MessageModel, original.id)
        assert historical.execution == original.execution
    assert regenerated.messages[-1].execution.model.id == uuid.UUID(A)
    assert regenerated.messages[-1].execution.configuration.system_prompt == "Regenerated instructions"
    assert regenerated.messages[-1].parent_message_id == original.id


@pytest.mark.asyncio
async def test_selection_transaction_blocks_send_and_generation_until_commit(project_api, monkeypatch):
    client, sessions, _ = project_api
    chat = await new_chat(client)
    chat_id = uuid.UUID(chat["info"]["id"])
    entered, release = asyncio.Event(), asyncio.Event()
    async with sessions() as changing:
        commit = changing.commit

        async def blocked_commit():
            entered.set()
            await release.wait()
            await commit()

        monkeypatch.setattr(changing, "commit", blocked_commit)
        task = asyncio.create_task(
            change_chat_model(
                user_id="a",
                chat_id=chat_id,
                payload=ChatModelUpdate(model_id=uuid.UUID(B), expected_model_revision=1),
                session=changing,
            ),
        )
        await asyncio.wait_for(entered.wait(), 3)
        job = chat_jobs.get_or_create(chat_id, SimpleNamespace(pending_approvals={}), user_id="a")
        try:
            with pytest.raises(CodedException):
                job.start(asyncio.sleep(0))
            async with sessions() as sending:
                with pytest.raises(CodedException):
                    await send_message(
                        user_id="a",
                        chat_id=chat_id,
                        payload=ChatSendRequest(
                            request_id=uuid.uuid4(),
                            user_prompt="Concurrent",
                            parent_message_id=None,
                            expected_model_revision=1,
                        ),
                        session=sending,
                    )
        finally:
            release.set()
            await task
            await chat_jobs.retire(chat_id)


@pytest.mark.asyncio
async def test_history_survives_catalog_rename_and_deletion_without_relabeling(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client)
    chat_id, parent = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as session:
        execution = await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent, session=session)
        answer = await add_message(
            "a",
            chat_id,
            NewMessageRequest(
                model_id=execution.model.id,
                role="assistant",
                content="Historical answer",
                parent_message_id=parent,
                status=MessageStatus.COMPLETED,
                execution=execution,
            ),
            session,
        )
        await session.execute(
            update(LLMModel).where(LLMModel.id == execution.model.id).values(name="Renamed catalog model"),
        )
        await session.commit()
        renamed = await get_one(chat_id, "a", session)
        assert renamed.info.selected_model.name == "Renamed catalog model"
        assert renamed.messages[-1].execution.model.name == "Chat A"
        await session.execute(delete(LLMModel).where(LLMModel.id == execution.model.id))
        await session.commit()
        missing = await get_one(chat_id, "a", session)
        assert missing.info.selected_model.available is False
        assert missing.messages[-1].id == answer.id
        assert missing.messages[-1].execution == execution


@pytest.mark.asyncio
async def test_replay_rechecks_capability_revocation_and_model_capability_changes(project_api):
    import asterism.domains.tools.builtin.web_fetch  # noqa: F401
    from asterism.domains.settings.models import ApplicationSettingsModel

    client, sessions, _ = project_api
    chat = await new_chat(client)
    chat_id, parent = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as session:
        session.add(ApplicationSettingsModel(key="active_tools", value=["web_fetch"]))
        await session.commit()
        await update_main_agent("a", MainAgentUpdate(tools=["web_fetch"]), session)
        await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent, session=session)
        await update_main_agent("a", MainAgentUpdate(tools=[]), session)
        with pytest.raises(CodedException, match="capabilities changed"):
            await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent, session=session)
        assert (await get_one(chat_id, "a", session)).info.resume_error
        fresh = await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent, restart=True, session=session)
        await session.execute(
            update(LLMModel).where(LLMModel.id == fresh.model.id).values(supports_vision=True, context_window=16384),
        )
        await session.commit()
        with pytest.raises(CodedException, match="identity changed"):
            await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent, session=session)
        regenerated = await prepare_execution(
            user_id="a",
            chat_id=chat_id,
            message_id=parent,
            restart=True,
            session=session,
        )
        assert regenerated.model.supports_vision and regenerated.model.context_window == 16384
