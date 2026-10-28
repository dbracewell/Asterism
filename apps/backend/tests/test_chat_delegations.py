import uuid
from unittest.mock import AsyncMock, patch

import pytest
from asterism.domains.agent.agent import Agent, AgentEvent, AgentEventType
from asterism.domains.agent.schemas import AgentProfile, SubAgentEventEnvelope
from asterism.domains.chat.delegations import DelegationCollector
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.chat.schemas import (
    Chat,
    ChatInfo,
    DelegationRecord,
    Message,
    MessageStatus,
    NewMessageRequest,
)
from asterism.domains.chat.service import add_message, get_one
from asterism.domains.llm.schemas import Function, ToolCall, ToolResult
from test_chat_models import new_chat
from test_chat_models import project_api as _project_api
from test_projects_api import auth
from tool_policy_doubles import isolated_tool_policy as _isolated_tool_policy

project_api = _project_api
isolated_tool_policy = _isolated_tool_policy

LEAD, CHILD = uuid.uuid4(), uuid.uuid4()


def call(call_id: str, name: str = "web_search") -> ToolCall:
    return ToolCall(id=call_id, function=Function(name=name, arguments="{}"))


def result(call_id: str) -> ToolResult:
    return ToolResult(tool_call=call(call_id), content="Hit", raw_result={"text": "Hit"}, is_empty=False)


def envelope(execution_id: uuid.UUID, event: AgentEvent, **extra) -> SubAgentEventEnvelope:
    return SubAgentEventEnvelope(
        execution_id=execution_id,
        sub_agent_id=uuid.UUID(int=7),
        sub_agent_name=extra.pop("name", "Researcher"),
        depth=extra.pop("depth", 1),
        event=event,
        **extra,
    )


def test_collector_records_identity_timing_tools_and_outcome():
    collector = DelegationCollector()
    collector.observe(envelope(LEAD, AgentEvent(type=AgentEventType.START), model_name="Gamma"), now_ms=1_000)
    collector.observe(
        envelope(CHILD, AgentEvent(type=AgentEventType.START), parent_execution_id=LEAD, depth=2, name="Checker"),
        now_ms=1_200,
    )
    collector.observe(envelope(LEAD, AgentEvent(type=AgentEventType.TOOL_CALL, tool_calls=[call("a")])), now_ms=1_500)
    collector.observe(
        envelope(LEAD, AgentEvent(type=AgentEventType.TOOL_CALL, tool_calls=[call("a"), call("b", "read")])),
        now_ms=2_000,
    )
    collector.observe(
        envelope(
            LEAD,
            AgentEvent(type=AgentEventType.COMPLETE, tool_calls=[call("a")], tool_results=[result("a")]),
        ),
        now_ms=2_200,
    )
    collector.observe(envelope(LEAD, AgentEvent(type=AgentEventType.DELTA, content="draft")), now_ms=2_500)
    collector.observe(envelope(LEAD, AgentEvent(type=AgentEventType.COMPLETE, content="Answer")), now_ms=4_000)
    collector.observe(envelope(CHILD, AgentEvent(type=AgentEventType.ERROR, content="Timed out")), now_ms=3_000)

    lead, child = collector.drain()
    assert lead == DelegationRecord(
        execution_id=LEAD,
        sub_agent_id=uuid.UUID(int=7),
        name="Researcher",
        model_name="Gamma",
        depth=1,
        status="completed",
        started_at_ms=1_000,
        ended_at_ms=4_000,
        tool_calls=[call("a"), call("b", "read")],
        tool_results=[result("a")],
        output="Answer",
    )
    assert child.parent_execution_id == LEAD
    assert (child.status, child.error, child.depth) == ("error", "Timed out", 2)
    assert collector.drain() == []


def test_collector_marks_unterminated_runs():
    collector = DelegationCollector()
    collector.observe(envelope(LEAD, AgentEvent(type=AgentEventType.START)), now_ms=1)
    assert [record.status for record in collector.drain(unfinished="cancelled")] == ["cancelled"]
    collector.observe(envelope(LEAD, AgentEvent(type=AgentEventType.START)), now_ms=1)
    assert [record.status for record in collector.drain()] == ["error"]


def _orchestrator() -> tuple[ChatOrchestrator, Message]:
    session = Chat(
        info=ChatInfo(id=uuid.uuid4(), user_id="user-123", created_at=0, updated_at=0, allowed_tools=["sub_agent"]),
        messages=[],
    )
    user_msg = Message(
        id=uuid.uuid4(),
        role="user",
        content="Hello",
        status=MessageStatus.PENDING,
        created_at=0,
    )
    session.messages.append(user_msg)
    profile = AgentProfile(
        id=uuid.uuid4(),
        name="Root",
        description="",
        sub_agent=True,
        model_id=uuid.uuid4(),
        system_prompt="",
        max_steps=5,
        tools=["sub_agent"],
    )
    agent = Agent(profile=profile, user=AsyncMock(id="user-123"), session=session, allowed_tools=["sub_agent"])
    agent.prepare_execution = AsyncMock(return_value=None)
    agent.prepare_execution_scope = AsyncMock(return_value=None)
    return ChatOrchestrator(agent), user_msg


@pytest.mark.asyncio
@pytest.mark.usefixtures("isolated_tool_policy")
async def test_orchestrator_attaches_step_delegations_to_the_persisted_message():
    orchestrator, user_msg = _orchestrator()

    async def run(messages):
        yield AgentEvent(type=AgentEventType.SUB_AGENT, sub_agent=envelope(LEAD, AgentEvent(type=AgentEventType.START)))
        yield AgentEvent(
            type=AgentEventType.SUB_AGENT,
            sub_agent=envelope(LEAD, AgentEvent(type=AgentEventType.COMPLETE, content="Answer")),
        )
        yield AgentEvent(type=AgentEventType.COMPLETE, content="", tool_calls=[call("sub", "sub_agent")])
        yield AgentEvent(type=AgentEventType.COMPLETE, content="Synthesis")

    saved = AsyncMock(return_value=user_msg)
    with (
        patch.object(orchestrator.agent, "run", side_effect=run),
        patch("asterism.domains.chat.service.add_message", new=saved),
    ):
        await orchestrator.run_agent()

    first, second = (call_args.kwargs["message"] for call_args in saved.await_args_list)
    assert [(record.execution_id, record.status, record.output) for record in first.delegations] == [
        (LEAD, "completed", "Answer")
    ]
    # Records belong to the step that ran them, not to later steps.
    assert second.delegations is None


@pytest.mark.asyncio
@pytest.mark.usefixtures("isolated_tool_policy")
async def test_cancel_keeps_in_flight_delegations_without_streamed_text():
    orchestrator, user_msg = _orchestrator()
    orchestrator._active_parent_id = user_msg.id
    orchestrator._delegations.observe(envelope(LEAD, AgentEvent(type=AgentEventType.START)))
    saved = AsyncMock(return_value=user_msg)
    with (
        patch("asterism.domains.chat.service.add_message", new=saved),
        patch("asterism.domains.chat.service.update_message", new=AsyncMock(return_value=user_msg)),
    ):
        await orchestrator.cancel_active_generation()
    partial = saved.await_args.kwargs["message"]
    assert partial.status == MessageStatus.CANCELLED
    assert [record.status for record in partial.delegations] == ["cancelled"]


@pytest.mark.asyncio
async def test_delegations_round_trip_through_history(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client)
    chat_id, parent = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    record = DelegationRecord(
        execution_id=LEAD,
        sub_agent_id=uuid.UUID(int=7),
        name="Researcher",
        model_name="Gamma",
        depth=1,
        status="completed",
        started_at_ms=1_000,
        ended_at_ms=4_000,
        tool_calls=[call("a")],
        output="Answer",
    )
    async with sessions() as session:
        execution = await prepare_execution(user_id="a", chat_id=chat_id, message_id=parent, session=session)
        await add_message(
            "a",
            chat_id,
            NewMessageRequest(
                model_id=execution.model.id,
                role="assistant",
                content="",
                tool_calls=[call("sub", "sub_agent")],
                delegations=[record],
                parent_message_id=parent,
                status=MessageStatus.COMPLETED,
                execution=execution,
            ),
            session,
        )
        await session.commit()
        reopened = await get_one(chat_id, "a", session)
    assert reopened.messages[-1].delegations == [record]
    body = (await client.get(f"/chat/{chat_id}", headers=auth())).json()
    assert body["messages"][-1]["delegations"][0]["model_name"] == "Gamma"
    # Another user cannot read them.
    assert (await client.get(f"/chat/{chat_id}", headers=auth("b"))).status_code == 404
