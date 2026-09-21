import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent, AgentEvent, AgentEventType
from asterism.domains.agent.schemas import AgentProfile, SubAgentEventEnvelope
from asterism.domains.chat.message_queue import get_message_queue
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.chat.schemas import Chat, ChatInfo, Message, MessageStatus
from asterism.domains.llm.schemas import (
    Function,
    LLMEvent,
    LLMEventType,
    LLMMessage,
    ToolCall,
)
from asterism.domains.tools.builtin.sub_agent import SubAgentArgs, sub_agent
from asterism.domains.tools.registry import ToolContext


@pytest.fixture
def test_user() -> AuthedUser:
    return AuthedUser(
        id="user-123",
        email="user@test.local",
        name="Test User",
        role="user",
    )


@pytest.fixture
def make_chat_session():
    def _create(allowed_tools: list[str]) -> Chat:
        return Chat(
            info=ChatInfo(
                id=uuid.uuid4(),
                user_id="user-123",
                created_at=0,
                updated_at=0,
                allowed_tools=allowed_tools,
            ),
            messages=[],
        )

    return _create


def _make_agent_profile(
    agent_id: uuid.UUID, name: str = "SubAgent"
) -> AgentProfile:
    return AgentProfile(
        id=agent_id,
        name=name,
        description=f"Description for {name}",
        sub_agent=True,
        model_id=uuid.uuid4(),
        system_prompt=f"You are {name}.",
        max_steps=5,
        tools=["sub_agent"],
    )


class DummyLLMClient:
    def __init__(self, responses: list[list[LLMEvent]]):
        self._responses = responses
        self._call_count = 0

    async def chat(
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        **kwargs,
    ) -> AsyncGenerator[LLMEvent, None]:
        if self._call_count < len(self._responses):
            step_events = self._responses[self._call_count]
            self._call_count += 1
            for event in step_events:
                yield event
        else:
            yield LLMEvent(
                type=LLMEventType.COMPLETE,
                content="Default done",
                finish_reason="stop",
            )


class TestSubAgentStreaming:
    @pytest.mark.asyncio
    async def test_sub_agent_event_envelope_metadata(self):
        """Verify SubAgentEventEnvelope carries sub_agent_id, name, depth,
        and event."""
        sub_agent_id = uuid.uuid4()
        event = AgentEvent(
            type=AgentEventType.DELTA,
            content="Thinking...",
            thinking="Step 1",
        )
        envelope = SubAgentEventEnvelope(
            sub_agent_id=sub_agent_id,
            sub_agent_name="Researcher",
            depth=1,
            event=event,
        )

        assert envelope.sub_agent_id == sub_agent_id
        assert envelope.sub_agent_name == "Researcher"
        assert envelope.depth == 1
        assert envelope.event.type == AgentEventType.DELTA
        assert envelope.event.content == "Thinking..."
        assert envelope.event.thinking == "Step 1"

    @pytest.mark.asyncio
    async def test_sub_agent_forwards_events_to_event_sink(
        self, test_user, make_chat_session
    ):
        """Verify sub_agent forwards DELTA, TOOL_CALL, and COMPLETE to sink."""
        root_id = uuid.uuid4()
        child_id = uuid.uuid4()
        child_profile = _make_agent_profile(child_id, "ChildWorker")
        session = make_chat_session(allowed_tools=["sub_agent"])

        intercepted_envelopes: list[SubAgentEventEnvelope] = []

        async def capture_sink(envelope: SubAgentEventEnvelope) -> None:
            intercepted_envelopes.append(envelope)

        ctx = ToolContext(
            args=SubAgentArgs(agent_id=child_id, prompt="Perform work"),
            user=test_user,
            user_message="Delegate task",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
            call_stack=[root_id],
            event_sink=capture_sink,
        )

        tool_call_item = ToolCall(
            id="call_test_1",
            function=Function(name="some_tool", arguments="{}"),
        )

        async def fake_child_run(self_agent, messages):
            yield AgentEvent(
                type=AgentEventType.DELTA,
                content="Progress text",
                thinking="Reasoning trace",
            )
            yield AgentEvent(
                type=AgentEventType.TOOL_CALL,
                tool_calls=[tool_call_item],
            )
            yield AgentEvent(
                type=AgentEventType.COMPLETE,
                content="Final child answer",
            )

        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(return_value=child_profile),
            ),
            patch.object(Agent, "run", new=fake_child_run),
        ):
            result = await sub_agent(ctx)
            assert result == "Final child answer"

        assert len(intercepted_envelopes) == 3

        # Event 1: DELTA
        assert intercepted_envelopes[0].sub_agent_id == child_id
        assert intercepted_envelopes[0].sub_agent_name == "ChildWorker"
        assert intercepted_envelopes[0].depth == 1
        assert intercepted_envelopes[0].event.type == AgentEventType.DELTA
        assert intercepted_envelopes[0].event.content == "Progress text"
        assert intercepted_envelopes[0].event.thinking == "Reasoning trace"

        # Event 2: TOOL_CALL
        assert intercepted_envelopes[1].event.type == AgentEventType.TOOL_CALL
        assert intercepted_envelopes[1].event.tool_calls == [tool_call_item]

        # Event 3: COMPLETE
        assert intercepted_envelopes[2].event.type == AgentEventType.COMPLETE
        assert intercepted_envelopes[2].event.content == "Final child answer"
        assert len({event.execution_id for event in intercepted_envelopes}) == 1

    @pytest.mark.asyncio
    async def test_sub_agent_forwards_start_and_error_as_terminal_diagnostics(
        self, test_user, make_chat_session, caplog
    ):
        root_id = uuid.uuid4()
        child_id = uuid.uuid4()
        child_profile = _make_agent_profile(child_id, "FailingWorker")
        session = make_chat_session(allowed_tools=["sub_agent"])
        intercepted: list[SubAgentEventEnvelope] = []

        async def capture_sink(envelope: SubAgentEventEnvelope) -> None:
            intercepted.append(envelope)

        ctx = ToolContext(
            args=SubAgentArgs(agent_id=child_id, prompt="Sensitive task text"),
            user=test_user,
            user_message="Delegate task",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
            call_stack=[root_id],
            event_sink=capture_sink,
        )

        async def fake_child_run(self_agent, messages):
            yield AgentEvent(type=AgentEventType.START)
            yield AgentEvent(
                type=AgentEventType.ERROR,
                content="Provider timed out",
            )

        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(return_value=child_profile),
            ),
            patch.object(Agent, "run", new=fake_child_run),
            patch(
                "asterism.domains.agent.service.create_sub_agent_trace",
                new=AsyncMock(),
            ),
            caplog.at_level("DEBUG", logger="SUB_AGENT"),
        ):
            result = await sub_agent(ctx)

        assert result == "Provider timed out"
        assert [item.event.type for item in intercepted] == [
            AgentEventType.START,
            AgentEventType.ERROR,
        ]
        assert len({item.execution_id for item in intercepted}) == 1
        assert "delegation requested" in caplog.text
        assert "delegation started" in caplog.text
        assert "delegation finished" in caplog.text
        assert "status=error" in caplog.text
        assert "Sensitive task text" not in caplog.text

    @pytest.mark.asyncio
    async def test_parent_agent_event_stream_includes_sub_agent_events(
        self, test_user, make_chat_session
    ):
        """Verify parent agent.run() yields SUB_AGENT events when child runs."""
        parent_id = uuid.uuid4()
        child_id = uuid.uuid4()
        parent_profile = _make_agent_profile(parent_id, "ParentAgent")
        child_profile = _make_agent_profile(child_id, "ChildWorker")

        session = make_chat_session(allowed_tools=["sub_agent"])

        sub_call = ToolCall(
            id="call_sub_1",
            function=Function(
                name="sub_agent",
                arguments=f'{{"agent_id": "{child_id}", "prompt": "Sub task"}}',
            ),
        )

        parent_llm = DummyLLMClient(
            responses=[
                [
                    LLMEvent(
                        type=LLMEventType.COMPLETE,
                        content="",
                        tool_calls=[sub_call],
                        finish_reason="tool_calls",
                    )
                ],
                [
                    LLMEvent(
                        type=LLMEventType.COMPLETE,
                        content="Parent synthesis of sub-agent answer.",
                        finish_reason="stop",
                    )
                ],
            ]
        )

        parent_agent = Agent(
            profile=parent_profile,
            user=test_user,
            session=session,
            allowed_tools=["sub_agent"],
        )

        real_agent_run = Agent.run

        async def conditional_agent_run(agent_instance, messages):
            if agent_instance.profile.id == child_id:
                yield AgentEvent(
                    type=AgentEventType.DELTA,
                    content="Child streaming delta",
                    thinking="Child thinking",
                )
                yield AgentEvent(
                    type=AgentEventType.COMPLETE,
                    content="Child final response",
                )
            else:
                async for evt in real_agent_run(agent_instance, messages):
                    yield evt

        parent_events: list[AgentEvent] = []
        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(return_value=child_profile),
            ),
            patch(
                "asterism.domains.agent.service.get_user_agents",
                new=AsyncMock(
                    return_value=MagicMock(agents={child_id: child_profile})
                ),
            ),
            patch(
                "asterism.domains.settings.service.get_app_settings",
                new=AsyncMock(
                    return_value=MagicMock(active_tools=["sub_agent"])
                ),
            ),
            patch.object(
                parent_agent,
                "_get_client",
                new=AsyncMock(return_value=parent_llm),
            ),
            patch.object(Agent, "run", new=conditional_agent_run),
        ):
            async for evt in parent_agent.run(
                messages=[LLMMessage.user("Delegate to sub-agent")]
            ):
                parent_events.append(evt)

        # Verify parent emitted SUB_AGENT events
        sub_agent_events = [
            e for e in parent_events if e.type == AgentEventType.SUB_AGENT
        ]
        assert len(sub_agent_events) >= 2

        delta_sub = sub_agent_events[0].sub_agent
        assert delta_sub is not None
        assert delta_sub.sub_agent_id == child_id
        assert delta_sub.sub_agent_name == "ChildWorker"
        assert delta_sub.depth == 1
        assert delta_sub.event.type == AgentEventType.DELTA
        assert delta_sub.event.content == "Child streaming delta"

        complete_sub = sub_agent_events[1].sub_agent
        assert complete_sub is not None
        assert complete_sub.event.type == AgentEventType.COMPLETE
        assert complete_sub.event.content == "Child final response"

        # Verify final parent COMPLETE event includes synthesis
        final_complete = parent_events[-1]
        assert final_complete.type == AgentEventType.COMPLETE
        assert final_complete.content == "Parent synthesis of sub-agent answer."

    @pytest.mark.asyncio
    async def test_multi_level_sub_agent_depth_forwarding(
        self, test_user, make_chat_session
    ):
        """Verify multi-level sub-agent call (depth 2) carries depth=2
        in envelope."""
        root_id = uuid.uuid4()
        agent_b_id = uuid.uuid4()
        agent_c_id = uuid.uuid4()

        child_c_profile = _make_agent_profile(agent_c_id, "WorkerC")
        session = make_chat_session(allowed_tools=["sub_agent"])

        captured: list[SubAgentEventEnvelope] = []

        async def capture_sink(envelope: SubAgentEventEnvelope) -> None:
            captured.append(envelope)

        ctx = ToolContext(
            args=SubAgentArgs(agent_id=agent_c_id, prompt="Sub task for C"),
            user=test_user,
            user_message="Work",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
            call_stack=[root_id, agent_b_id],  # Already at depth 2
            event_sink=capture_sink,
        )

        async def fake_c_run(self_agent, messages):
            yield AgentEvent(type=AgentEventType.DELTA, content="C delta")
            yield AgentEvent(type=AgentEventType.COMPLETE, content="C complete")

        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(return_value=child_c_profile),
            ),
            patch.object(Agent, "run", new=fake_c_run),
        ):
            await sub_agent(ctx)

        assert len(captured) == 2
        assert captured[0].depth == 2
        assert captured[0].sub_agent_id == agent_c_id
        assert captured[1].depth == 2

    @pytest.mark.asyncio
    async def test_chat_orchestrator_forwards_sub_agent_events_to_queue(
        self, test_user, make_chat_session
    ):
        """Verify ChatOrchestrator forwards SUB_AGENT events to
        message queue."""
        agent_id = uuid.uuid4()
        sub_id = uuid.uuid4()
        profile = _make_agent_profile(agent_id, "RootAgent")
        session = make_chat_session(allowed_tools=["sub_agent"])

        # Add a pending user message to chat session
        user_msg = Message(
            id=uuid.uuid4(),
            chat_id=session.info.id,  # type:ignore
            role="user",
            content="Hello",
            status=MessageStatus.PENDING,
            created_at=0,
            updated_at=0,  # type:ignore
        )
        session.messages.append(user_msg)

        agent = Agent(
            profile=profile,
            user=test_user,
            session=session,
            allowed_tools=["sub_agent"],
        )

        orchestrator = ChatOrchestrator(agent)
        queue = get_message_queue(session.info.id)

        envelope = SubAgentEventEnvelope(
            sub_agent_id=sub_id,
            sub_agent_name="SubWorker",
            depth=1,
            event=AgentEvent(
                type=AgentEventType.DELTA,
                content="Sub-agent delta",
                thinking="Sub-agent thinking",
            ),
        )

        async def fake_run_with_sub_agent(messages):
            # Yield sub-agent event
            yield AgentEvent(
                type=AgentEventType.SUB_AGENT,
                sub_agent=envelope,
            )
            # Yield final complete
            yield AgentEvent(
                type=AgentEventType.COMPLETE,
                content="Root finished",
            )

        with (
            patch.object(agent, "run", side_effect=fake_run_with_sub_agent),
            patch(
                "asterism.domains.chat.service.add_message",
                new=AsyncMock(return_value=user_msg),
            ),
        ):
            await orchestrator.run_agent()

        # Check messages put into queue
        queued_messages = []
        while not queue.empty():
            queued_messages.append(await queue.get())

        sub_agent_packets = [
            pkt
            for pkt in queued_messages
            if isinstance(pkt, dict) and pkt.get("type") == "sub_agent"
        ]
        assert len(sub_agent_packets) == 1
        assert sub_agent_packets[0]["execution_id"] == str(
            envelope.execution_id
        )
        assert sub_agent_packets[0]["sub_agent_id"] == str(sub_id)
        assert sub_agent_packets[0]["sub_agent_name"] == "SubWorker"
        assert sub_agent_packets[0]["depth"] == 1
        assert sub_agent_packets[0]["event"]["type"] == "delta"
        assert sub_agent_packets[0]["event"]["content"] == "Sub-agent delta"
