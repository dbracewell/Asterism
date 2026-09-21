import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from asterism.core.schemas import AuthedUser
from asterism.db.base import Base
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.router import get_traces_for_parent_message
from asterism.domains.agent.schemas import (
    AgentProfile,
    SubAgentTraceCreate,
)
from asterism.domains.agent.service import (
    create_sub_agent_trace,
    get_sub_agent_traces_by_parent_message,
)
from asterism.domains.chat.models import ChatModel, MessageModel
from asterism.domains.chat.schemas import Chat, ChatInfo, Message
from asterism.domains.llm.schemas import (
    Function,
    LLMEvent,
    LLMEventType,
    LLMMessage,
    ToolCall,
)
from asterism.domains.tools.builtin.sub_agent import (
    SubAgentArgs,
    sub_agent,
)
from asterism.domains.tools.registry import ToolContext
from asterism.domains.user.models import UserModel
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


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
    def _create(
        allowed_tools: list[str], messages: list[Message] | None = None
    ) -> Chat:
        return Chat(
            info=ChatInfo(
                id=uuid.uuid4(),
                user_id="user-123",
                created_at=0,
                updated_at=0,
                allowed_tools=allowed_tools,
            ),
            messages=messages or [],
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


class RecordingLLMClient:
    def __init__(self, responses: list[list[LLMEvent]] | None = None):
        self.recorded_messages: list[list[LLMMessage]] = []
        self._responses = responses or []
        self._call_count = 0

    async def chat(
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        **kwargs,
    ) -> AsyncGenerator[LLMEvent, None]:
        self.recorded_messages.append(list(messages))
        if self._call_count < len(self._responses):
            step_events = self._responses[self._call_count]
            self._call_count += 1
            for event in step_events:
                yield event
        else:
            yield LLMEvent(
                type=LLMEventType.COMPLETE,
                content="Sub-agent finished delegated work.",
                total_tokens=42,
                finish_reason="stop",
            )


async def setup_test_db() -> tuple[
    AsyncEngine, async_sessionmaker[AsyncSession]
]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    async with session_maker() as session:
        user = UserModel(
            id="user-123",
        )
        session.add(user)

        chat_id = uuid.uuid4()
        chat = ChatModel(
            id=chat_id,
            user_id="user-123",
            allowed_tools=["sub_agent"],
        )
        session.add(chat)

        parent_msg_id = uuid.uuid4()
        parent_msg = MessageModel(
            id=parent_msg_id,
            user_id="user-123",
            chat_id=chat_id,
            role="user",
            content="Please delegate this task.",
        )
        session.add(parent_msg)

        sub_agent_id = uuid.uuid4()
        agent_profile = AgentProfileModel(
            id=sub_agent_id,
            user_id="user-123",
            name="ResearchAgent",
            description="Researches facts",
            sub_agent=True,
            system_prompt="You research facts.",
        )
        session.add(agent_profile)

        await session.commit()

    return engine, session_maker


class TestSubAgentTraces:
    @pytest.mark.asyncio
    async def test_create_and_get_sub_agent_traces(self):
        """
        Verify that sub-agent traces can be persisted to the database and
        retrieved by parent_message_id with all metrics and message history.
        """
        engine, session_maker = await setup_test_db()
        try:
            async with session_maker() as session:
                user_id = "user-123"

                from sqlalchemy import select

                msg = (
                    await session.scalars(
                        select(MessageModel).where(
                            MessageModel.user_id == user_id
                        )
                    )
                ).first()
                agent = (
                    await session.scalars(
                        select(AgentProfileModel).where(
                            AgentProfileModel.user_id == user_id
                        )
                    )
                ).first()
                assert msg is not None
                assert agent is not None

                trace_create = SubAgentTraceCreate(
                    user_id=user_id,
                    parent_message_id=msg.id,
                    sub_agent_id=agent.id,
                    sub_agent_name=agent.name,
                    prompt="Find information on Asterism",
                    caller_context="High priority",
                    messages=[
                        {"role": "system", "content": "You research facts."},
                        {
                            "role": "user",
                            "content": "Find information on Asterism",
                        },
                        {
                            "role": "assistant",
                            "content": "Asterism is a multi-agent system.",
                        },
                    ],
                    result="Asterism is a multi-agent system.",
                    step_count=1,
                    total_tokens=150,
                    elapsed_ms=320,
                    depth=0,
                )

                created_trace = await create_sub_agent_trace(
                    trace_create, session=session
                )
                assert created_trace.id is not None
                assert created_trace.parent_message_id == msg.id
                assert created_trace.sub_agent_id == agent.id
                assert created_trace.sub_agent_name == "ResearchAgent"
                assert created_trace.step_count == 1
                assert created_trace.total_tokens == 150
                assert created_trace.elapsed_ms == 320
                assert len(created_trace.messages) == 3

                # Query by parent message
                retrieved = await get_sub_agent_traces_by_parent_message(
                    user_id=user_id,
                    parent_message_id=msg.id,
                    session=session,
                )
                assert len(retrieved) == 1
                assert retrieved[0].id == created_trace.id
                assert (
                    retrieved[0].result == "Asterism is a multi-agent system."
                )
                assert retrieved[0].caller_context == "High priority"
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_sub_agent_tool_automatically_persists_trace(
        self, test_user, make_chat_session
    ):
        """
        Verify that executing the sub_agent tool automatically captures
        metrics, steps, and full message history and persists a trace record.
        """
        parent_msg_id = uuid.uuid4()
        session = make_chat_session(allowed_tools=["sub_agent"])
        sub_agent_id = uuid.uuid4()
        sub_agent_profile = _make_agent_profile(
            sub_agent_id, name="WorkerAgent"
        )

        recording_client = RecordingLLMClient()
        persisted_traces: list[SubAgentTraceCreate] = []

        async def _mock_create_trace(trace_data, session=None):
            persisted_traces.append(trace_data)
            return MagicMock(id=uuid.uuid4())

        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(return_value=sub_agent_profile),
            ),
            patch.object(
                Agent,
                "_get_client",
                new=AsyncMock(return_value=recording_client),
            ),
            patch(
                "asterism.domains.agent.service.get_user_agents",
                new=AsyncMock(
                    return_value=MagicMock(
                        agents={sub_agent_id: sub_agent_profile}
                    )
                ),
            ),
            patch(
                "asterism.domains.settings.service.get_app_settings",
                new=AsyncMock(
                    return_value=MagicMock(
                        active_tools=["sub_agent"],
                        retrieval_model_id=None,
                        embedding_model_id=None,
                    )
                ),
            ),
            patch(
                "asterism.domains.agent.service.create_sub_agent_trace",
                side_effect=_mock_create_trace,
            ),
        ):
            ctx = ToolContext(
                args=SubAgentArgs(
                    agent_id=sub_agent_id,
                    prompt="Perform delegated calculation.",
                    parent_context="Use exact integers.",
                ),
                user=test_user,
                user_message="Perform delegated calculation.",
                session=session,
                app_settings=MagicMock(),
                client=recording_client,  # type:ignore
                parent_message_id=parent_msg_id,
            )

            result = await sub_agent(ctx)
            assert result == "Sub-agent finished delegated work."

            # Verify trace was persisted with all required data
            assert len(persisted_traces) == 1
            trace = persisted_traces[0]
            assert trace.user_id == test_user.id
            assert trace.parent_message_id == parent_msg_id
            assert trace.sub_agent_id == sub_agent_id
            assert trace.sub_agent_name == "WorkerAgent"
            assert trace.prompt == "Perform delegated calculation."
            assert trace.caller_context == "Use exact integers."
            assert trace.result == "Sub-agent finished delegated work."
            assert trace.step_count == 1
            assert trace.total_tokens == 42
            assert trace.elapsed_ms >= 0
            assert trace.depth == 0
            # Ensure full message history was captured
            assert len(trace.messages) >= 2
            assert any(
                "You are WorkerAgent." in str(m.get("content"))
                for m in trace.messages
            )

    @pytest.mark.asyncio
    async def test_sub_agent_trace_with_tool_calls_in_history(
        self, test_user, make_chat_session
    ):
        """
        Verify that sub-agent message history in trace captures intermediate
        tool calls and tool results before completion.
        """
        parent_msg_id = uuid.uuid4()
        session = make_chat_session(allowed_tools=["sub_agent"])
        sub_agent_id = uuid.uuid4()
        sub_agent_profile = _make_agent_profile(
            sub_agent_id, name="ToolUserAgent"
        )
        sub_agent_profile.tools = ["sub_agent"]

        step1 = [
            LLMEvent(
                type=LLMEventType.COMPLETE,
                tool_calls=[
                    ToolCall(
                        id="call_x",
                        function=Function(
                            name="sub_agent",
                            arguments='{"agent_id": "%s", "prompt": "nested"}'
                            % sub_agent_id,
                        ),
                    )
                ],
                finish_reason="tool_calls",
                total_tokens=20,
            )
        ]
        step2 = [
            LLMEvent(
                type=LLMEventType.COMPLETE,
                content="Finished after recursion check aborted nested.",
                finish_reason="stop",
                total_tokens=30,
            )
        ]
        recording_client = RecordingLLMClient(responses=[step1, step2])
        persisted_traces: list[SubAgentTraceCreate] = []

        async def _mock_create_trace(trace_data, session=None):
            persisted_traces.append(trace_data)
            return MagicMock(id=uuid.uuid4())

        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(return_value=sub_agent_profile),
            ),
            patch.object(
                Agent,
                "_get_client",
                new=AsyncMock(return_value=recording_client),
            ),
            patch(
                "asterism.domains.agent.service.get_user_agents",
                new=AsyncMock(
                    return_value=MagicMock(
                        agents={sub_agent_id: sub_agent_profile}
                    )
                ),
            ),
            patch(
                "asterism.domains.settings.service.get_app_settings",
                new=AsyncMock(
                    return_value=MagicMock(
                        active_tools=["sub_agent"],
                        retrieval_model_id=None,
                        embedding_model_id=None,
                    )
                ),
            ),
            patch(
                "asterism.domains.agent.service.create_sub_agent_trace",
                side_effect=_mock_create_trace,
            ),
        ):
            ctx = ToolContext(
                args=SubAgentArgs(
                    agent_id=sub_agent_id,
                    prompt="Run multi-step task",
                ),
                user=test_user,
                user_message="Run multi-step task",
                session=session,
                app_settings=MagicMock(),
                client=recording_client,  # type:ignore
                parent_message_id=parent_msg_id,
                call_stack=[uuid.uuid4()],  # Depth 1
            )

            result = await sub_agent(ctx)
            assert result == "Finished after recursion check aborted nested."

            assert len(persisted_traces) == 1
            trace = persisted_traces[0]
            assert trace.step_count == 2
            assert trace.total_tokens == 50
            assert trace.depth == 1

            # Verify intermediate tool call and result are preserved in messages
            roles = [m.get("role") for m in trace.messages]
            assert "system" in roles
            assert "user" in roles
            assert "assistant" in roles
            assert "tool" in roles

    @pytest.mark.asyncio
    async def test_get_traces_router_endpoint(self, test_user):
        """
        Verify the GET /agents/traces/{parent_message_id} router handler
        returns list of traces for the authorized user.
        """
        engine, session_maker = await setup_test_db()
        try:
            async with session_maker() as session:
                user_id = test_user.id

                from sqlalchemy import select

                msg = (
                    await session.scalars(
                        select(MessageModel).where(
                            MessageModel.user_id == user_id
                        )
                    )
                ).first()
                agent = (
                    await session.scalars(
                        select(AgentProfileModel).where(
                            AgentProfileModel.user_id == user_id
                        )
                    )
                ).first()
                assert msg is not None
                assert agent is not None

                # Insert 2 traces for this message
                for i in range(2):
                    await create_sub_agent_trace(
                        SubAgentTraceCreate(
                            user_id=user_id,
                            parent_message_id=msg.id,
                            sub_agent_id=agent.id,
                            sub_agent_name=agent.name,
                            prompt=f"Task {i}",
                            messages=[{"role": "user", "content": f"Task {i}"}],
                            result=f"Done {i}",
                            step_count=1,
                            total_tokens=10 * (i + 1),
                        ),
                        session=session,
                    )

                # Call the router endpoint handler
                traces = await get_traces_for_parent_message(
                    parent_message_id=msg.id,
                    user=test_user,
                    session=session,
                )
                assert len(traces) == 2
                assert traces[0].prompt == "Task 0"
                assert traces[1].prompt == "Task 1"
                assert traces[0].total_tokens == 10
                assert traces[1].total_tokens == 20
        finally:
            await engine.dispose()
