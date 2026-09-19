import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from asterism.core.config import config
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent, AgentEvent, AgentEventType
from asterism.domains.agent.schemas import AgentProfile
from asterism.domains.chat.schemas import Chat, ChatInfo
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


class TestSubAgentRecursionSafety:
    @pytest.mark.asyncio
    async def test_no_recursion_depth_1(self, test_user, make_chat_session):
        """Root agent calls sub-agent (depth 1): succeeds and
        propagates call stack."""
        root_id = uuid.uuid4()
        child_id = uuid.uuid4()
        child_profile = _make_agent_profile(child_id, "ChildAgent")

        session = make_chat_session(allowed_tools=["sub_agent"])
        ctx = ToolContext(
            args=SubAgentArgs(agent_id=child_id, prompt="Hello from root"),
            user=test_user,
            user_message="Delegate task",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
            call_stack=[root_id],
        )

        captured_child_agent = None

        async def fake_run(self_agent, messages):
            nonlocal captured_child_agent
            captured_child_agent = self_agent
            yield AgentEvent(
                type=AgentEventType.COMPLETE,
                content="Child task completed successfully.",
            )

        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(return_value=child_profile),
            ),
            patch.object(Agent, "run", new=fake_run),
        ):
            result = await sub_agent(ctx)
            assert result == "Child task completed successfully."
            assert captured_child_agent is not None
            assert captured_child_agent.call_stack == [root_id, child_id]

    @pytest.mark.asyncio
    async def test_allowed_depth_2_and_3(self, test_user, make_chat_session):
        """Sub-agent calls at depths 2 and 3 are within limit (3)
        and succeed."""
        root_id = uuid.uuid4()
        agent_b_id = uuid.uuid4()
        agent_c_id = uuid.uuid4()
        agent_d_id = uuid.uuid4()

        session = make_chat_session(allowed_tools=["sub_agent"])

        # Depth 2: Root -> B -> C
        ctx_depth_2 = ToolContext(
            args=SubAgentArgs(agent_id=agent_c_id, prompt="Task for C"),
            user=test_user,
            user_message="Delegate to C",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
            call_stack=[root_id, agent_b_id],
        )

        captured_agent = None

        async def fake_run(self_agent, messages):
            nonlocal captured_agent
            captured_agent = self_agent
            yield AgentEvent(type=AgentEventType.COMPLETE, content="Done C")

        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(
                    return_value=_make_agent_profile(agent_c_id, "C")
                ),
            ),
            patch.object(Agent, "run", new=fake_run),
        ):
            result = await sub_agent(ctx_depth_2)
            assert result == "Done C"
            assert captured_agent.call_stack == [  # type:ignore
                root_id,
                agent_b_id,
                agent_c_id,
            ]

        # Depth 3: Root -> B -> C -> D
        ctx_depth_3 = ToolContext(
            args=SubAgentArgs(agent_id=agent_d_id, prompt="Task for D"),
            user=test_user,
            user_message="Delegate to D",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
            call_stack=[root_id, agent_b_id, agent_c_id],
        )

        async def fake_run_d(self_agent, messages):
            nonlocal captured_agent
            captured_agent = self_agent
            yield AgentEvent(type=AgentEventType.COMPLETE, content="Done D")

        with (
            patch(
                "asterism.domains.agent.service.get_agent_profile",
                new=AsyncMock(
                    return_value=_make_agent_profile(agent_d_id, "D")
                ),
            ),
            patch.object(Agent, "run", new=fake_run_d),
        ):
            result = await sub_agent(ctx_depth_3)
            assert result == "Done D"
            assert captured_agent.call_stack == [  # type:ignore
                root_id,
                agent_b_id,
                agent_c_id,
                agent_d_id,
            ]

    @pytest.mark.asyncio
    async def test_cycle_detection_direct_self_recursion(
        self, test_user, make_chat_session
    ):
        """Direct self-recursion (A calling A) is detected and rejected."""
        root_id = uuid.uuid4()
        session = make_chat_session(allowed_tools=["sub_agent"])

        ctx = ToolContext(
            args=SubAgentArgs(agent_id=root_id, prompt="Call self"),
            user=test_user,
            user_message="Call self",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
            call_stack=[root_id],
        )

        result = await sub_agent(ctx)
        assert "Recursion cycle detected" in result
        assert str(root_id) in result
        assert f"{root_id} -> {root_id}" in result
        assert "Sub-agent call aborted" in result

    @pytest.mark.asyncio
    async def test_cycle_detection_indirect_cycle(
        self, test_user, make_chat_session
    ):
        """Indirect cycle (A -> B -> A) is detected and rejected."""
        root_id = uuid.uuid4()
        agent_b_id = uuid.uuid4()
        session = make_chat_session(allowed_tools=["sub_agent"])

        # Agent B is running with call_stack [A, B] and attempts to call A
        ctx = ToolContext(
            args=SubAgentArgs(agent_id=root_id, prompt="Calling A back"),
            user=test_user,
            user_message="Calling A back",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
            call_stack=[root_id, agent_b_id],
        )

        result = await sub_agent(ctx)
        assert "Recursion cycle detected" in result
        assert f"{root_id} -> {agent_b_id} -> {root_id}" in result
        assert "Sub-agent call aborted" in result

    @pytest.mark.asyncio
    async def test_cycle_detection_multi_hop_cycle(
        self, test_user, make_chat_session
    ):
        """Multi-hop cycle (A -> B -> C -> B) is detected and rejected."""
        root_id = uuid.uuid4()
        agent_b_id = uuid.uuid4()
        agent_c_id = uuid.uuid4()
        session = make_chat_session(allowed_tools=["sub_agent"])

        # Agent C is running with call_stack [A, B, C] and attempts to call B
        ctx = ToolContext(
            args=SubAgentArgs(agent_id=agent_b_id, prompt="Calling B from C"),
            user=test_user,
            user_message="Calling B from C",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
            call_stack=[root_id, agent_b_id, agent_c_id],
        )

        result = await sub_agent(ctx)
        assert "Recursion cycle detected" in result
        assert (
            f"{root_id} -> {agent_b_id} -> {agent_c_id} -> {agent_b_id}"
            in result
        )
        assert "Sub-agent call aborted" in result

    @pytest.mark.asyncio
    async def test_depth_exceeded_default_limit(
        self, test_user, make_chat_session
    ):
        """Attempting to exceed maximum sub-agent depth (default: 3)
        is rejected."""
        root_id = uuid.uuid4()
        agent_b_id = uuid.uuid4()
        agent_c_id = uuid.uuid4()
        agent_d_id = uuid.uuid4()
        agent_e_id = uuid.uuid4()

        session = make_chat_session(allowed_tools=["sub_agent"])

        # Stack already has root + 3 sub-agents (length 4).
        # Calling E would be depth 4 sub-agent.
        ctx = ToolContext(
            args=SubAgentArgs(agent_id=agent_e_id, prompt="Calling E"),
            user=test_user,
            user_message="Calling E",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
            call_stack=[root_id, agent_b_id, agent_c_id, agent_d_id],
        )

        result = await sub_agent(ctx)
        assert "Maximum sub-agent recursion depth of 3 exceeded" in result
        assert "Please decompose the task differently" in result
        assert "Sub-agent call aborted" in result

    @pytest.mark.asyncio
    async def test_depth_limit_configurable(
        self, monkeypatch, test_user, make_chat_session
    ):
        """Overriding max_sub_agent_depth enforces the configured limit."""
        monkeypatch.setattr(config, "max_sub_agent_depth", 1)

        root_id = uuid.uuid4()
        agent_b_id = uuid.uuid4()
        agent_c_id = uuid.uuid4()

        session = make_chat_session(allowed_tools=["sub_agent"])

        # Call stack has [root, B] (length 2).
        # With max_sub_agent_depth = 1, calling C exceeds limit.
        ctx = ToolContext(
            args=SubAgentArgs(agent_id=agent_c_id, prompt="Calling C"),
            user=test_user,
            user_message="Calling C",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
            call_stack=[root_id, agent_b_id],
        )

        result = await sub_agent(ctx)
        assert "Maximum sub-agent recursion depth of 1 exceeded" in result
        assert "Please decompose the task differently" in result


class TestAgentCallStackInitialization:
    def test_agent_initializes_call_stack_with_profile_id(
        self, test_user, make_chat_session
    ):
        profile_id = uuid.uuid4()
        profile = _make_agent_profile(profile_id, "TestAgent")
        session = make_chat_session(allowed_tools=[])

        agent = Agent(
            profile=profile,
            user=test_user,
            session=session,
        )
        assert agent.call_stack == [profile_id]

    def test_agent_initializes_call_stack_from_provided_stack(
        self, test_user, make_chat_session
    ):
        profile_id = uuid.uuid4()
        parent_id = uuid.uuid4()
        profile = _make_agent_profile(profile_id, "TestAgent")
        session = make_chat_session(allowed_tools=[])

        agent = Agent(
            profile=profile,
            user=test_user,
            session=session,
            call_stack=[parent_id, profile_id],
        )
        assert agent.call_stack == [parent_id, profile_id]
