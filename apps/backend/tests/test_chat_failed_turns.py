"""US-77.2: a turn that ends in an error leaves PENDING and is never re-run on reconnect."""

import uuid

import pytest
from asterism.domains.agent.schemas import AgentEvent, AgentEventType
from asterism.domains.chat.models import MessageModel
from asterism.domains.chat.schemas import MessageStatus
from asterism.domains.llm.schemas import Function, ToolCall, ToolResult
from sqlalchemy import select
from test_chat_comparisons import A, B, Runtime, compare_chat, comparison, drain
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api


class FailingRuntime(Runtime):
    """A real orchestrator whose model run is one of the scripted outcomes below."""

    def __init__(self, chat_id, sessions, monkeypatch, outcome):
        super().__init__(chat_id, sessions, monkeypatch)
        self.outcome = outcome
        self.calls = 0

    async def build(self):
        orchestrator = await super().build()
        runtime = self

        async def generate(*, messages, replay=None):
            runtime.calls += 1
            async for event in runtime.outcome(orchestrator.agent):
                yield event

        self.monkeypatch.setattr(orchestrator.agent, "run", generate)
        return orchestrator


async def error_event(agent):
    yield AgentEvent(type=AgentEventType.START)
    yield AgentEvent(type=AgentEventType.DELTA, content="Partial ans")
    yield AgentEvent(type=AgentEventType.ERROR, content="Provider rejected the request", error_code="rate_limited")


async def empty_response(agent):
    yield AgentEvent(type=AgentEventType.START)
    yield AgentEvent(type=AgentEventType.COMPLETE, content="  ")


async def raises(agent):
    yield AgentEvent(type=AgentEventType.START)
    raise RuntimeError("Provider connection reset")


async def fails_after_a_tool_step(agent):
    call = ToolCall(id="call-1", function=Function(name="lookup", arguments="{}"))
    yield AgentEvent(type=AgentEventType.START)
    yield AgentEvent(type=AgentEventType.DELTA, content="Looking it up")
    yield AgentEvent(
        type=AgentEventType.COMPLETE,
        content="Looking it up",
        tool_calls=[call],
        tool_results=[ToolResult(content="42", raw_result=None, is_empty=False, tool_call=call)],
    )
    yield AgentEvent(type=AgentEventType.START)
    yield AgentEvent(type=AgentEventType.ERROR, content="Stream ended unexpectedly")


async def new_chat(client):
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={"request_id": str(uuid.uuid4()), "user_prompt": "Explain tides", "model_id": A},
    )
    assert response.status_code == 200, response.text
    return uuid.UUID(response.json()["info"]["id"])


async def messages(sessions, chat_id):
    async with sessions() as session:
        rows = await session.scalars(
            select(MessageModel).where(MessageModel.chat_id == chat_id).order_by(MessageModel.created_at)
        )
        return list(rows)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("outcome", "content", "error", "code"),
    [
        (error_event, "Partial ans", "Provider rejected the request", "rate_limited"),
        (empty_response, "", "The model returned an empty response. Please try again.", None),
        (raises, "", "Provider connection reset", None),
    ],
)
async def test_failed_turn_is_recorded_and_not_rerun_on_reconnect(
    project_api, monkeypatch, outcome, content, error, code
):
    client, sessions, _ = project_api
    chat_id = await new_chat(client)
    runtime = FailingRuntime(chat_id, sessions, monkeypatch, outcome)
    orchestrator = await runtime.build()

    await orchestrator.resume_pending_turn()

    request, failed = await messages(sessions, chat_id)
    assert request.status == MessageStatus.FAILED
    assert request.active_child_id == failed.id
    assert (failed.role, failed.status, failed.content, failed.error) == (
        "assistant",
        MessageStatus.FAILED,
        content,
        error,
    )
    packets = drain(orchestrator)
    complete = next(packet for packet in packets if packet["type"] == "complete")
    assert [message["status"] for message in complete["last_messages"]] == ["failed", "failed"]
    assert packets[-1] == {"type": "error", "content": error, "error_code": code}

    # Reconnecting finds no pending turn, so the model is never called again.
    await (await runtime.build()).resume_pending_turn()
    assert runtime.calls == 1
    assert len(await messages(sessions, chat_id)) == 2

    # The reopened chat still shows the failure.
    opened = (await client.get(f"/chat/{chat_id}", headers=auth())).json()
    assert [(message["status"], message["error"]) for message in opened["messages"]] == [
        ("failed", None),
        ("failed", error),
    ]


@pytest.mark.asyncio
async def test_failure_after_a_tool_step_attaches_to_that_step(project_api, monkeypatch):
    client, sessions, _ = project_api
    chat_id = await new_chat(client)
    runtime = FailingRuntime(chat_id, sessions, monkeypatch, fails_after_a_tool_step)
    orchestrator = await runtime.build()

    await orchestrator.resume_pending_turn()

    request, step, failed = await messages(sessions, chat_id)
    assert request.status == MessageStatus.FAILED
    assert step.status == MessageStatus.COMPLETED and step.parent_message_id == request.id
    # The failed step answers the tool step and does not repeat its text.
    assert failed.parent_message_id == step.id
    assert (failed.status, failed.content, failed.error) == (MessageStatus.FAILED, "", "Stream ended unexpectedly")
    await (await runtime.build()).resume_pending_turn()
    assert runtime.calls == 1


@pytest.mark.asyncio
async def test_failed_comparison_column_is_failed_and_the_next_column_still_runs(project_api, monkeypatch):
    client, sessions, _ = project_api
    accepted = (await compare_chat(client)).json()
    chat_id = uuid.UUID(accepted["info"]["id"])

    async def first_column_fails(agent):
        if str(agent.model_id) == A:
            async for event in error_event(agent):
                yield event
            return
        yield AgentEvent(type=AgentEventType.START)
        yield AgentEvent(type=AgentEventType.COMPLETE, content=f"Answer from {agent.model_id}")

    runtime = FailingRuntime(chat_id, sessions, monkeypatch, first_column_fails)
    orchestrator = await runtime.build()
    await orchestrator.resume_pending_turn()

    packets = drain(orchestrator)
    error = next(packet for packet in packets if packet["type"] == "error")
    assert error["comparison"]["column_id"] == accepted["messages"][0]["id"]
    result = await comparison(client, chat_id, accepted["messages"][0]["comparison_id"])
    assert [(column["status"], column["model"]["id"]) for column in result["columns"]] == [
        ("failed", A),
        ("completed", B),
    ]
    assert result["columns"][0]["replies"][0]["error"] == "Provider rejected the request"

    await (await runtime.build()).resume_pending_turn()
    assert runtime.calls == 2
