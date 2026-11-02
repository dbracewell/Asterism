"""US-54.4: side-by-side comparison columns are sibling branches run within chat admission limits."""

import asyncio
import uuid
from contextlib import asynccontextmanager

import pytest
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import AgentEvent, AgentEventType
from asterism.domains.agent.service import get_main_agent_profile
from asterism.domains.chat.capacity import ChatCapacityError, ChatCapacityLimits
from asterism.domains.chat.jobs import ChatJobManager
from asterism.domains.chat.model_selection import change_chat_model
from asterism.domains.chat.models import ChatModel, MessageModel
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.chat.schemas import ChatModelUpdate
from asterism.domains.chat.service import get_one
from asterism.domains.settings.models import LLMModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
A, B = str(uuid.UUID(int=1)), str(uuid.UUID(int=2))


def compare(*model_ids, prompt=None):
    return [{"model_id": model_id, **({"user_prompt": prompt} if prompt else {})} for model_id in model_ids]


async def compare_chat(client, targets=None, user="a", prompt="Explain tides"):
    return await client.post(
        "/chat/",
        headers=auth(user),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": prompt,
            "model_id": A,
            "compare": targets if targets is not None else compare(A, B),
        },
    )


async def comparison(client, chat_id, comparison_id, user="a"):
    response = await client.get(f"/chat/{chat_id}/comparisons/{comparison_id}", headers=auth(user))
    assert response.status_code == 200, response.text
    return response.json()


class Runtime:
    """A real orchestrator whose model replies name the model that ran and record its history."""

    def __init__(self, chat_id, sessions, monkeypatch):
        self.chat_id = chat_id
        self.sessions = sessions
        self.monkeypatch = monkeypatch
        self.histories: list[list[str]] = []
        self.gate: asyncio.Event | None = None

        @asynccontextmanager
        async def database(supplied=None):
            if supplied is not None:
                yield supplied
            else:
                async with sessions() as session:
                    yield session

        for domain in ["execution", "service"]:
            monkeypatch.setattr(f"asterism.domains.chat.{domain}.get_async_db_session", database)

    async def build(self) -> ChatOrchestrator:
        async with self.sessions() as session:
            opened = await get_one(self.chat_id, "a", session)
            profile = await get_main_agent_profile("a", session)
        agent = Agent(
            profile=profile,
            user=AuthedUser(id="a", name="A", email="a@example.test", role="user"),
            session=opened,
            model_id=opened.info.selected_model_id,
        )
        runtime = self

        async def generate(*, messages, replay=None):
            runtime.histories.append([message.content for message in messages if isinstance(message.content, str)])
            yield AgentEvent(type=AgentEventType.START)
            if runtime.gate is not None:
                await runtime.gate.wait()
            yield AgentEvent(
                type=AgentEventType.COMPLETE,
                content=f"Answer from {agent.model_id}",
                input_tokens=10,
                output_tokens=5,
                total_tokens=15,
            )

        self.monkeypatch.setattr(agent, "run", generate)
        return ChatOrchestrator(agent)


def drain(orchestrator: ChatOrchestrator) -> list[dict]:
    packets = []
    while not orchestrator.queue.empty():
        packets.append(orchestrator.queue.get_nowait())
    return packets


@pytest.mark.asyncio
async def test_composer_comparison_creates_sibling_root_columns_with_fixed_targets(project_api):
    client, sessions, _ = project_api
    response = await compare_chat(client)
    assert response.status_code == 200, response.text
    accepted = response.json()
    chat_id = accepted["info"]["id"]
    column = accepted["messages"][0]
    assert (column["comparison_index"], column["target_model_id"]) == (0, A)

    opened = (await client.get(f"/chat/{chat_id}", headers=auth())).json()
    assert [message["id"] for message in opened["messages"]] == [column["id"]]

    result = await comparison(client, chat_id, column["comparison_id"])
    assert result["active_index"] == 0 and result["parent_message_id"] is None
    assert [(item["index"], item["status"], item["model"]["id"]) for item in result["columns"]] == [
        (0, "pending", A),
        (1, "pending", B),
    ]
    assert {item["request"]["content"] for item in result["columns"]} == {"Explain tides"}
    async with sessions() as session:
        chat = await session.get(ChatModel, uuid.UUID(chat_id))
        assert chat.active_root_id == uuid.UUID(column["id"])

    # Owner-scoped like every chat read.
    foreign = await client.get(f"/chat/{chat_id}/comparisons/{column['comparison_id']}", headers=auth("b"))
    assert foreign.status_code == 404


@pytest.mark.asyncio
async def test_comparison_targets_are_bounded_distinct_and_available(project_api):
    client, sessions, _ = project_api
    assert (await compare_chat(client, compare(A))).status_code == 422
    assert (await compare_chat(client, compare(A, B, A, B))).status_code == 422
    duplicate = await compare_chat(client, compare(A, A))
    assert duplicate.status_code == 400 and "differ" in duplicate.json()["detail"]
    assert (await compare_chat(client, compare(A, str(uuid.uuid4())))).status_code == 409
    # The same model with a different prompt is a valid pair (US-51.7's before/after).
    variant = await compare_chat(client, [{"model_id": A}, {"model_id": A, "user_prompt": "Explain tides to a child"}])
    assert variant.status_code == 200, variant.text
    async with sessions() as session:
        await session.execute(update(LLMModel).where(LLMModel.id == uuid.UUID(B)).values(is_active=False))
        await session.commit()
    assert (await compare_chat(client)).status_code == 409


@pytest.mark.asyncio
async def test_columns_run_one_after_another_on_their_own_models_and_histories(project_api, monkeypatch):
    client, sessions, _ = project_api
    accepted = (await compare_chat(client)).json()
    chat_id = uuid.UUID(accepted["info"]["id"])
    comparison_id = accepted["messages"][0]["comparison_id"]
    runtime = Runtime(chat_id, sessions, monkeypatch)
    orchestrator = await runtime.build()

    await orchestrator.resume_pending_turn()

    result = await comparison(client, chat_id, comparison_id)
    assert [item["status"] for item in result["columns"]] == ["completed", "completed"]
    for item, model in zip(result["columns"], [A, B]):
        (reply,) = item["replies"]
        assert reply["content"] == f"Answer from {model}"
        assert reply["execution"]["model"]["id"] == model
        assert reply["parent_message_id"] == item["request"]["id"]
        assert (item["input_tokens"], item["output_tokens"], item["total_tokens"]) == (10, 5, 15)
    # Each column saw only its own turn, never the other column's answer.
    assert runtime.histories == [["Explain tides"], ["Explain tides"]]

    packets = drain(orchestrator)
    starts = [packet for packet in packets if packet["type"] == "start"]
    completes = [packet for packet in packets if packet["type"] == "complete"]
    columns = [item["request"]["id"] for item in result["columns"]]
    assert [packet["comparison"]["column_id"] for packet in starts] == columns
    assert [packet["comparison"]["column_id"] for packet in completes] == columns
    assert all(packet["comparison"]["id"] == comparison_id for packet in starts + completes)

    # The conversation still continues from column 0.
    opened = (await client.get(f"/chat/{chat_id}", headers=auth())).json()
    assert [message["content"] for message in opened["messages"]] == ["Explain tides", f"Answer from {A}"]


@pytest.mark.asyncio
async def test_a_comparison_uses_one_work_slot_and_respects_owner_admission(project_api, monkeypatch):
    client, sessions, _ = project_api
    accepted = (await compare_chat(client)).json()
    chat_id = uuid.UUID(accepted["info"]["id"])
    runtime = Runtime(chat_id, sessions, monkeypatch)
    manager = ChatJobManager(ChatCapacityLimits(active_jobs=2, active_jobs_per_user=1))

    # The owner's only slot is busy elsewhere: the comparison is rejected, not queued.
    busy = manager.get_or_create(uuid.uuid4(), await runtime.build(), user_id="a")
    busy.controllers = 1
    blocker = asyncio.Event()
    busy.start(blocker.wait())
    job = manager.get_or_create(chat_id, await runtime.build(), user_id="a")
    job.controllers = 1
    with pytest.raises(ChatCapacityError):
        job.start(job.orchestrator.resume_pending_turn())  # type: ignore[attr-defined]
    blocker.set()
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert manager.active_count == 0
    result = await comparison(client, chat_id, accepted["messages"][0]["comparison_id"])
    assert [item["status"] for item in result["columns"]] == ["pending", "pending"]

    # Admitted, both columns run inside that single slot.
    runtime.gate = asyncio.Event()
    task = job.start(job.orchestrator.resume_pending_turn())  # type: ignore[attr-defined]
    for _ in range(50):
        await asyncio.sleep(0)
    assert manager.active_count == 1
    runtime.gate.set()
    await task
    assert len(runtime.histories) == 2
    await asyncio.sleep(0)
    assert manager.active_count == 0


@pytest.mark.asyncio
async def test_cancelling_stops_the_current_column_and_cancels_the_rest(project_api, monkeypatch):
    client, sessions, _ = project_api
    accepted = (await compare_chat(client)).json()
    chat_id = uuid.UUID(accepted["info"]["id"])
    runtime = Runtime(chat_id, sessions, monkeypatch)
    runtime.gate = asyncio.Event()
    orchestrator = await runtime.build()

    task = asyncio.create_task(orchestrator.resume_pending_turn())
    while not runtime.histories:
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    result = await comparison(client, chat_id, accepted["messages"][0]["comparison_id"])
    assert [item["status"] for item in result["columns"]] == ["cancelled", "cancelled"]
    # A reconnect has nothing left to run.
    runtime.gate = None
    await (await runtime.build()).resume_pending_turn()
    assert len(runtime.histories) == 1


@pytest.mark.asyncio
async def test_continuing_from_another_column_moves_the_branch_and_later_turns_follow_it(project_api, monkeypatch):
    client, sessions, _ = project_api
    accepted = (await compare_chat(client)).json()
    chat_id = accepted["info"]["id"]
    comparison_id = accepted["messages"][0]["comparison_id"]
    path = f"/chat/{chat_id}/comparisons/{comparison_id}/active"

    # Sends wait until every column has answered.
    blocked = await client.post(
        f"/chat/{chat_id}/message",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "expected_model_revision": 1,
            "user_prompt": "Next",
            "parent_message_id": accepted["messages"][0]["id"],
        },
    )
    assert blocked.status_code == 409

    await (await Runtime(uuid.UUID(chat_id), sessions, monkeypatch).build()).resume_pending_turn()
    assert (await client.put(path, headers=auth("b"), json={"index": 1})).status_code == 404
    assert (await client.put(path, headers=auth(), json={"index": 2})).status_code == 404
    switched = await client.put(path, headers=auth(), json={"index": 1})
    assert switched.status_code == 200, switched.text
    assert switched.json()["active_index"] == 1

    opened = (await client.get(f"/chat/{chat_id}", headers=auth())).json()
    assert opened["messages"][-1]["content"] == f"Answer from {B}"
    sent = await client.post(
        f"/chat/{chat_id}/message",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "expected_model_revision": 1,
            "user_prompt": "Go deeper",
            "parent_message_id": opened["messages"][-1]["id"],
        },
    )
    assert sent.status_code == 200, sent.text
    branch = (await client.get(f"/chat/{chat_id}", headers=auth())).json()["messages"]
    assert [message["content"] for message in branch] == ["Explain tides", f"Answer from {B}", "Go deeper"]
    # A plain follow-up is not a comparison and runs on the chat's selected model.
    assert branch[-1]["comparison_id"] is None


@pytest.mark.asyncio
async def test_comparing_in_an_existing_chat_branches_under_the_current_leaf(project_api, monkeypatch):
    client, sessions, _ = project_api
    chat = (
        await client.post(
            "/chat/",
            headers=auth(),
            json={"request_id": str(uuid.uuid4()), "user_prompt": "Hello", "model_id": A},
        )
    ).json()
    chat_id = chat["info"]["id"]
    await (await Runtime(uuid.UUID(chat_id), sessions, monkeypatch).build()).resume_pending_turn()
    leaf = (await client.get(f"/chat/{chat_id}", headers=auth())).json()["messages"][-1]

    sent = await client.post(
        f"/chat/{chat_id}/message",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "expected_model_revision": 1,
            "user_prompt": "Compare this",
            "parent_message_id": leaf["id"],
            "compare": compare(A, B),
        },
    )
    assert sent.status_code == 200, sent.text
    result = await comparison(client, chat_id, sent.json()["comparison_id"])
    assert result["parent_message_id"] == leaf["id"] and result["active_index"] == 0
    async with sessions() as session:
        parent = await session.get(MessageModel, uuid.UUID(leaf["id"]))
        assert parent.active_child_id == uuid.UUID(result["columns"][0]["request"]["id"])


@pytest.mark.asyncio
async def test_an_answered_turn_becomes_column_zero_of_a_new_comparison(project_api, monkeypatch):
    client, sessions, _ = project_api
    chat = (
        await client.post(
            "/chat/",
            headers=auth(),
            json={"request_id": str(uuid.uuid4()), "user_prompt": "Hello", "model_id": A},
        )
    ).json()
    chat_id, source = chat["info"]["id"], chat["messages"][0]["id"]
    path = f"/chat/{chat_id}/message/{source}/compare"
    body = {"request_id": str(uuid.uuid4()), "targets": compare(B)}

    unanswered = await client.post(path, headers=auth(), json=body)
    assert unanswered.status_code == 409 and "awaiting generation" in unanswered.json()["detail"]

    runtime = Runtime(uuid.UUID(chat_id), sessions, monkeypatch)
    await (await runtime.build()).resume_pending_turn()
    assert (await client.post(path, headers=auth("b"), json=body)).status_code == 404
    same = await client.post(path, headers=auth(), json={"request_id": str(uuid.uuid4()), "targets": compare(A)})
    assert same.status_code == 400

    created = await client.post(path, headers=auth(), json=body)
    assert created.status_code == 200, created.text
    result = created.json()
    assert result["active_index"] == 0
    assert [(item["status"], item["model"]["id"]) for item in result["columns"]] == [("completed", A), ("pending", B)]
    original, added = result["columns"]
    assert original["request"]["id"] == source
    assert added["request"]["content"] == "Hello"
    assert added["request"]["parent_message_id"] is None

    # Replaying the acknowledgement is idempotent; a changed payload is not.
    assert (await client.post(path, headers=auth(), json=body)).json()["id"] == result["id"]
    reused = await client.post(path, headers=auth(), json={**body, "targets": compare(B, B)})
    assert reused.status_code in (409, 422)
    again = await client.post(path, headers=auth(), json={"request_id": str(uuid.uuid4()), "targets": compare(B)})
    assert again.status_code == 409

    await (await runtime.build()).resume_pending_turn()
    finished = await comparison(client, chat_id, result["id"])
    assert finished["columns"][1]["replies"][0]["content"] == f"Answer from {B}"
    # The original reply was not rerun.
    assert len(runtime.histories) == 2


@pytest.mark.asyncio
async def test_comparison_columns_are_immutable(project_api):
    client, sessions, _ = project_api
    accepted = (await compare_chat(client)).json()
    column_id = uuid.UUID(accepted["messages"][0]["id"])
    async with sessions() as session:
        with pytest.raises(IntegrityError, match="immutable"):
            await session.execute(
                update(MessageModel).where(MessageModel.id == column_id).values(target_model_id=uuid.UUID(B))
            )
        await session.rollback()
        with pytest.raises(IntegrityError):
            await session.execute(
                update(MessageModel)
                .where(MessageModel.comparison_id.is_not(None), MessageModel.id != column_id)
                .values(comparison_index=0)
            )


@pytest.mark.asyncio
async def test_regenerating_inside_a_running_job_keeps_the_columns_target(project_api, monkeypatch):
    """Regeneration runs inside the chat job; it must not trip the idle-change guard."""
    client, sessions, _ = project_api
    accepted = (await compare_chat(client)).json()
    chat_id = uuid.UUID(accepted["info"]["id"])
    runtime = Runtime(chat_id, sessions, monkeypatch)
    orchestrator = await runtime.build()
    manager = ChatJobManager()
    monkeypatch.setattr("asterism.domains.chat.jobs.chat_jobs", manager)
    monkeypatch.setattr("asterism.domains.chat.service.chat_jobs", manager)
    job = manager.get_or_create(chat_id, orchestrator, user_id="a")
    job.controllers = 1
    await job.start(orchestrator.resume_pending_turn())

    async with sessions() as session:
        await change_chat_model(
            user_id="a",
            chat_id=chat_id,
            payload=ChatModelUpdate(model_id=uuid.UUID(B), expected_model_revision=1),
            session=session,
        )
    await orchestrator.reload_chat()
    await job.start(orchestrator.handle_regenerate_message(0))

    result = await comparison(client, chat_id, accepted["messages"][0]["comparison_id"])
    first = result["columns"][0]
    assert first["replies"][-1]["execution"]["model"]["id"] == A
    async with sessions() as session:
        siblings = await session.scalars(
            select(MessageModel).where(MessageModel.parent_message_id == uuid.UUID(first["request"]["id"]))
        )
        assert len(list(siblings)) == 2


@pytest.mark.asyncio
async def test_an_injected_start_carries_the_comparison_tag(monkeypatch):
    """Providers that emit no start event get one from the controller; it must name the column."""
    from types import SimpleNamespace

    from asterism.domains.chat.controller import ChatController
    from asterism.domains.chat.message_queue import get_message_queue

    sent: list[dict] = []

    class Connection:
        async def send_json(self, packet):
            sent.append(packet)

    chat_id = uuid.uuid4()
    job = SimpleNamespace(manager=None, orchestrator=None)
    controller = ChatController(chat_id, Connection(), job, None)  # type: ignore[arg-type]
    controller._is_running = True
    queue = get_message_queue(chat_id)
    tag = {"id": "cmp", "column_id": "column"}
    await queue.put({"type": "delta", "content": "Hi", "thinking": "", "comparison": tag})
    await queue.put({"type": "complete", "last_messages": [], "comparison": tag})
    await queue.put({"type": "delta", "content": "Plain", "thinking": ""})

    loop = asyncio.create_task(controller._message_queue_processing_loop())
    while len(sent) < 5:
        await asyncio.sleep(0)
    loop.cancel()

    assert [packet["type"] for packet in sent] == ["start", "delta", "complete", "start", "delta"]
    assert sent[0]["comparison"] == tag
    # An ordinary turn's injected start stays untagged.
    assert "comparison" not in sent[3]


@pytest.mark.asyncio
async def test_a_before_after_comparison_runs_both_prompts_on_one_model(project_api, monkeypatch):
    """US-51.7: the coach's original and improved prompts as labelled columns on the same model."""
    client, sessions, _ = project_api
    original, improved = "Write about dogs.", "Write a one-page care guide for a new puppy."
    targets = [
        {"model_id": A, "label": "  Before "},
        {"model_id": A, "user_prompt": improved, "label": "After"},
    ]
    template = {"source": "framework", "id": "rtf", "revision": 1, "level": "guided"}
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": original,
            "model_id": A,
            "compare": targets,
            "template": template,
        },
    )
    assert response.status_code == 200, response.text
    accepted = response.json()
    chat_id = uuid.UUID(accepted["info"]["id"])
    runtime = Runtime(chat_id, sessions, monkeypatch)
    await (await runtime.build()).resume_pending_turn()

    result = await comparison(client, chat_id, accepted["messages"][0]["comparison_id"])
    before, after = result["columns"]
    assert (before["request"]["comparison_label"], after["request"]["comparison_label"]) == ("Before", "After")
    assert (before["request"]["content"], after["request"]["content"]) == (original, improved)
    assert {column["replies"][0]["execution"]["model"]["id"] for column in result["columns"]} == {A}
    assert runtime.histories == [[original], [improved]]
    # The template built the original prompt, so only that column carries its label.
    assert before["request"]["template"]["id"] == "rtf"
    assert after["request"]["template"] is None

    # Labels are short headings.
    too_long = await compare_chat(client, [{"model_id": A, "label": "x" * 41}, {"model_id": B}])
    assert too_long.status_code == 422
    blank = await compare_chat(client, [{"model_id": A, "label": ""}, {"model_id": B}])
    assert blank.status_code == 422
    async with sessions() as session:
        with pytest.raises(IntegrityError, match="immutable"):
            await session.execute(
                update(MessageModel)
                .where(MessageModel.id == uuid.UUID(after["request"]["id"]))
                .values(comparison_label="Changed")
            )
