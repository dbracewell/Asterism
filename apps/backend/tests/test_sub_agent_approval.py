import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent, AgentEvent, AgentEventType
from asterism.domains.agent.approval import AllowlistApprovalPolicy
from asterism.domains.agent.schemas import AgentProfile
from asterism.domains.chat.schemas import Chat, ChatInfo
from asterism.domains.llm.schemas import (
    Function,
    LLMEvent,
    LLMEventType,
    LLMMessage,
    ToolCall,
)
from asterism.domains.tools.builtin.sub_agent import SubAgentArgs, sub_agent
from asterism.domains.tools.registry import ToolContext


def _make_tool_call(name: str, tool_id: str = "") -> ToolCall:
    return ToolCall(
        id=tool_id or f"call_{name}",
        function=Function(name=name, arguments="{}"),
    )


class DummyLLMClient:
    """Mock LLM client that can return specified tool calls and responses."""

    def __init__(self, responses: list[list[LLMEvent]]):
        self._responses = responses
        self._call_count = 0
        self.recorded_tools: list[list[str] | None] = []

    async def chat(
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        **kwargs,
    ) -> AsyncGenerator[LLMEvent, None]:
        self.recorded_tools.append(tools)
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


class TestSubAgentProfileAuthorization:
    @pytest.mark.asyncio
    async def test_sub_agent_cannot_execute_tools_outside_profile_allowlist(
        self, test_user, make_chat_session
    ):
        """
        Parent allows: ['search', 'calculator', 'bash']
        Sub-agent profile allows: ['search']
        If sub-agent calls 'calculator', it must be rejected as unauthorized.
        """
        sub_agent_id = uuid.uuid4()
        sub_profile = AgentProfile(
            id=sub_agent_id,
            name="Research Sub-Agent",
            description="Performs research",
            sub_agent=True,
            model_id=uuid.uuid4(),
            system_prompt="You are a researcher.",
            max_steps=5,
            tools=["search"],
        )

        session = make_chat_session(
            allowed_tools=["search", "calculator", "bash"]
        )

        ctx = ToolContext(
            args=SubAgentArgs(agent_id=sub_agent_id, prompt="Calculate 2+2"),
            user=test_user,
            user_message="Calculate 2+2",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
        )

        calc_call = _make_tool_call("calculator")

        mock_llm = DummyLLMClient(
            responses=[
                [
                    LLMEvent(
                        type=LLMEventType.COMPLETE,
                        content="",
                        tool_calls=[calc_call],
                        finish_reason="tool_calls",
                    )
                ],
                [
                    LLMEvent(
                        type=LLMEventType.COMPLETE,
                        content=(
                            "I could not calculate because "
                            "calculator is not authorized."
                        ),
                        finish_reason="stop",
                    )
                ],
            ]
        )

        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(return_value=sub_profile),
            ),
            patch(
                "asterism.domains.agent.agent.Agent._get_client",
                new=AsyncMock(return_value=mock_llm),
            ),
        ):
            result = await sub_agent(ctx)
            assert "calculator is not authorized" in result

            # Only tools explicitly assigned to the child are offered.
            assert mock_llm.recorded_tools[0] == ["search"]

    @pytest.mark.asyncio
    async def test_sub_agent_uses_profile_tools_not_parent_tool_list(
        self, test_user, make_chat_session
    ):
        """A specialist child keeps its tools after delegated authorization."""
        sub_agent_id = uuid.uuid4()
        sub_profile = AgentProfile(
            id=sub_agent_id,
            name="Research Sub-Agent",
            description="Searches and fetches sources",
            sub_agent=True,
            model_id=uuid.uuid4(),
            system_prompt="You are a researcher.",
            max_steps=5,
            tools=["web_search", "web_fetch"],
        )
        session = make_chat_session(allowed_tools=["sub_agent"])
        ctx = ToolContext(
            args=SubAgentArgs(agent_id=sub_agent_id, prompt="Research this"),
            user=test_user,
            user_message="Research this",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
        )

        created_agent = None
        orig_init = Agent.__init__

        def capture_init(self, *args, **kwargs):
            nonlocal created_agent
            orig_init(self, *args, **kwargs)
            created_agent = self

        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(return_value=sub_profile),
            ),
            patch.object(
                Agent, "__init__", side_effect=capture_init, autospec=True
            ),
            patch.object(Agent, "run") as mock_run,
        ):

            async def complete(*args, **kwargs):
                yield AgentEvent(type=AgentEventType.COMPLETE, content="Done")

            mock_run.side_effect = complete
            await sub_agent(ctx)

        assert created_agent is not None
        assert created_agent.allowed_tools == ["web_fetch", "web_search"]
        assert created_agent.profile.tools == ["web_fetch", "web_search"]
        assert isinstance(
            created_agent._approval_policy, AllowlistApprovalPolicy
        )

    @pytest.mark.asyncio
    async def test_sub_agent_allowed_tools_are_its_profile_allowlist(
        self, test_user, make_chat_session
    ):
        """Parent permissions do not remove child profile capabilities."""
        sub_agent_id = uuid.uuid4()
        sub_profile = AgentProfile(
            id=sub_agent_id,
            name="Math Sub-Agent",
            description="Performs math",
            sub_agent=True,
            model_id=uuid.uuid4(),
            system_prompt="You are a math helper.",
            max_steps=5,
            tools=["calculator", "browser"],
        )

        session = make_chat_session(allowed_tools=["search", "calculator"])

        ctx = ToolContext(
            args=SubAgentArgs(agent_id=sub_agent_id, prompt="Do math"),
            user=test_user,
            user_message="Do math",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
        )

        created_agent = None

        orig_init = Agent.__init__

        def capture_init(self, *args, **kwargs):
            nonlocal created_agent
            orig_init(self, *args, **kwargs)
            created_agent = self

        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(return_value=sub_profile),
            ),
            patch.object(
                Agent, "__init__", side_effect=capture_init, autospec=True
            ),
        ):
            with patch.object(Agent, "run") as mock_run:

                async def empty_gen(*args, **kwargs):
                    yield AgentEvent(
                        type=AgentEventType.COMPLETE, content="Done"
                    )

                mock_run.side_effect = empty_gen
                await sub_agent(ctx)  # type:ignore

        assert created_agent is not None
        assert created_agent.allowed_tools == ["browser", "calculator"]
        assert created_agent.profile.tools == ["browser", "calculator"]
        assert isinstance(
            created_agent._approval_policy, AllowlistApprovalPolicy
        )

    @pytest.mark.asyncio
    async def test_sub_agent_with_empty_tools(
        self, test_user, make_chat_session
    ):
        """
        A sub-agent with no assigned tools receives an empty allowlist.
        """
        sub_agent_id = uuid.uuid4()
        sub_profile = AgentProfile(
            id=sub_agent_id,
            name="No-tools Agent",
            description="Has no tools",
            sub_agent=True,
            model_id=uuid.uuid4(),
            system_prompt="No tools.",
            max_steps=5,
            tools=[],
        )

        session = make_chat_session(allowed_tools=["search"])

        ctx = ToolContext(
            args=SubAgentArgs(agent_id=sub_agent_id, prompt="Hello"),
            user=test_user,
            user_message="Hello",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
        )

        created_agent = None
        orig_init = Agent.__init__

        def capture_init(self, *args, **kwargs):
            nonlocal created_agent
            orig_init(self, *args, **kwargs)
            created_agent = self

        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(return_value=sub_profile),
            ),
            patch.object(
                Agent, "__init__", side_effect=capture_init, autospec=True
            ),
        ):
            with patch.object(Agent, "run") as mock_run:

                async def empty_gen(*args, **kwargs):
                    yield AgentEvent(
                        type=AgentEventType.COMPLETE, content="Done"
                    )

                mock_run.side_effect = empty_gen
                await sub_agent(ctx)

        assert created_agent is not None
        assert created_agent.allowed_tools == []
        assert created_agent.profile.tools == []
