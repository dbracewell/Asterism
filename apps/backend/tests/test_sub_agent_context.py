import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from asterism.core.config import config
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import AgentProfile
from asterism.domains.chat.schemas import Chat, ChatInfo, Message, MessageStatus
from asterism.domains.llm.schemas import (
    Function,
    LLMEvent,
    LLMEventType,
    LLMMessage,
    ToolCall,
)
from asterism.domains.tools.builtin.sub_agent import (
    SubAgentArgs,
    _build_parent_context_block,
    sub_agent,
)
from asterism.domains.tools.registry import ToolContext, tool_registry
from pydantic import BaseModel


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


def _make_message(role: str, content: str) -> Message:
    return Message(
        id=uuid.uuid4(),
        role=role,
        content=content,
        status=MessageStatus.COMPLETED,
        created_at=1000,
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
                content="Sub-agent finished successfully",
                finish_reason="stop",
            )


class TestSubAgentContextForwarding:
    @pytest.mark.asyncio
    async def test_sub_agent_receives_parent_conversation_context(
        self, test_user, make_chat_session
    ):
        """
        Verify recent messages from parent chat session are forwarded
        in system context.
        """
        messages = [
            _make_message("user", "What is Asterism?"),
            _make_message(
                "assistant", "Asterism is an AI multi-agent platform."
            ),
            _make_message("user", "Can you inspect the architecture?"),
        ]
        session = make_chat_session(
            allowed_tools=["sub_agent"], messages=messages
        )
        sub_agent_id = uuid.uuid4()
        sub_agent_profile = _make_agent_profile(
            sub_agent_id, name="InspectorAgent"
        )

        recording_client = RecordingLLMClient()

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
        ):
            ctx = ToolContext(
                args=SubAgentArgs(
                    agent_id=sub_agent_id,
                    prompt="Analyze the architecture document.",
                ),
                user=test_user,
                user_message="Can you inspect the architecture?",
                session=session,
                app_settings=MagicMock(),
                client=recording_client,  # type:ignore
            )

            result = await sub_agent(ctx)
            assert result == "Sub-agent finished successfully"

            # Check messages passed to sub-agent's LLM
            assert len(recording_client.recorded_messages) >= 1
            sub_msgs = recording_client.recorded_messages[0]

            # 1. Profile system prompt
            assert sub_msgs[0].role == "system"
            assert "You are InspectorAgent." in sub_msgs[0].content

            # 2. Forwarded parent context block
            assert sub_msgs[1].role == "system"
            assert "--- FORWARDED PARENT CONTEXT ---" in sub_msgs[1].content
            assert "### Recent Conversation History" in sub_msgs[1].content
            assert "[User]: What is Asterism?" in sub_msgs[1].content
            assert (
                "[Assistant]: Asterism is an AI multi-agent platform."
                in sub_msgs[1].content
            )
            assert (
                "[User]: Can you inspect the architecture?"
                in sub_msgs[1].content
            )

            # 3. Sub-agent prompt
            assert sub_msgs[2].role == "user"
            assert sub_msgs[2].content == "Analyze the architecture document."

    @pytest.mark.asyncio
    async def test_sub_agent_context_window_message_limit(
        self, test_user, make_chat_session, monkeypatch
    ):
        """Verify context window limits the number of forwarded messages to N."""  # noqa: E501
        monkeypatch.setattr(config, "sub_agent_context_window_messages", 3)
        monkeypatch.setattr(config, "sub_agent_context_window_tokens", 50000)

        messages = [
            _make_message("user", f"Old message {i}") for i in range(10)
        ]
        session = make_chat_session(
            allowed_tools=["sub_agent"], messages=messages
        )

        ctx = ToolContext(
            args=SubAgentArgs(
                agent_id=uuid.uuid4(),
                prompt="Do work",
            ),
            user=test_user,
            user_message="Do work",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
        )

        context_block = _build_parent_context_block(ctx)
        assert context_block is not None

        # Should only have Old message 7, 8, 9 (the last 3)
        assert "Old message 9" in context_block
        assert "Old message 8" in context_block
        assert "Old message 7" in context_block
        assert "Old message 6" not in context_block
        assert "Old message 0" not in context_block

    @pytest.mark.asyncio
    async def test_sub_agent_context_window_token_limit(
        self, test_user, make_chat_session, monkeypatch
    ):
        """Verify context window stops when accumulated token limit is exceeded."""  # noqa: E501
        monkeypatch.setattr(config, "sub_agent_context_window_messages", 20)
        monkeypatch.setattr(config, "sub_agent_context_window_tokens", 7)

        # The tokenizer counts each short message as roughly three tokens.
        messages = [_make_message("user", f"Message {i}") for i in range(5)]
        session = make_chat_session(
            allowed_tools=["sub_agent"], messages=messages
        )

        ctx = ToolContext(
            args=SubAgentArgs(
                agent_id=uuid.uuid4(),
                prompt="Do work",
            ),
            user=test_user,
            user_message="Do work",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
        )

        context_block = _build_parent_context_block(ctx)
        assert context_block is not None

        # The two latest messages fit; adding the third exceeds the budget.
        assert "Message 4" in context_block
        assert "Message 3" in context_block
        assert "Message 2" not in context_block

    @pytest.mark.asyncio
    async def test_sub_agent_forwards_user_files_in_context_block(
        self, test_user, make_chat_session
    ):
        """
        Verify user_files from ToolContext are included in the forwarded
        context block.
        """
        session = make_chat_session(allowed_tools=["sub_agent"])
        user_files = ["specs/spec.md", "data/schema.sql"]

        ctx = ToolContext(
            args=SubAgentArgs(
                agent_id=uuid.uuid4(),
                prompt="Review files",
            ),
            user=test_user,
            user_message="Review files",
            session=session,
            user_files=user_files,
            app_settings=MagicMock(),
            client=MagicMock(),
        )

        context_block = _build_parent_context_block(ctx)
        assert context_block is not None
        assert "### Available User Files" in context_block
        assert "- specs/spec.md" in context_block
        assert "- data/schema.sql" in context_block

    @pytest.mark.asyncio
    async def test_sub_agent_forwards_user_files_to_child_tool_context(
        self, test_user, make_chat_session
    ):
        """
        Verify user_files are propagated so tools executed by the sub-agent
        receive them.
        """
        sub_agent_id = uuid.uuid4()
        sub_agent_profile = _make_agent_profile(
            sub_agent_id, name="FileToolAgent"
        )
        sub_agent_profile.tools = ["mock_file_tool"]

        session = make_chat_session(
            allowed_tools=["sub_agent", "mock_file_tool"]
        )
        user_files = ["uploaded_report.pdf"]

        observed_files_in_child_tool: list[str] = []

        class MockFileArgs(BaseModel):
            pass

        @tool_registry.tool(
            name="mock_file_tool", description="Mock file reader"
        )
        def mock_file_tool(t_ctx: ToolContext[MockFileArgs]) -> str:
            observed_files_in_child_tool.extend(t_ctx.user_files)
            return "File read successfully"

        step1_events = [
            LLMEvent(
                type=LLMEventType.COMPLETE,
                tool_calls=[
                    ToolCall(
                        id="call_file_1",
                        function=Function(
                            name="mock_file_tool",
                            arguments="{}",
                        ),
                    )
                ],
                finish_reason="tool_calls",
            )
        ]
        step2_events = [
            LLMEvent(
                type=LLMEventType.COMPLETE,
                content="Finished reading file.",
                finish_reason="stop",
            )
        ]
        recording_client = RecordingLLMClient(
            responses=[step1_events, step2_events]
        )

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
                        active_tools=["mock_file_tool"],
                        retrieval_model_id=None,
                        embedding_model_id=None,
                    )
                ),
            ),
        ):
            ctx = ToolContext(
                args=SubAgentArgs(
                    agent_id=sub_agent_id,
                    prompt="Read the uploaded file",
                ),
                user=test_user,
                user_message="Read the uploaded file",
                session=session,
                user_files=user_files,
                app_settings=MagicMock(),
                client=recording_client,  # type:ignore
            )

            result = await sub_agent(ctx)
            assert result == "Finished reading file."
            assert observed_files_in_child_tool == ["uploaded_report.pdf"]

    @pytest.mark.asyncio
    async def test_sub_agent_caller_supplied_parent_context(
        self, test_user, make_chat_session
    ):
        """Verify caller notes passed in SubAgentArgs.parent_context are forwarded."""  # noqa: E501
        session = make_chat_session(allowed_tools=["sub_agent"])

        ctx = ToolContext(
            args=SubAgentArgs(
                agent_id=uuid.uuid4(),
                prompt="Optimize query",
                parent_context="The database has 10M rows and indexing is required.",  # noqa: E501
            ),
            user=test_user,
            user_message="Optimize query",
            session=session,
            app_settings=MagicMock(),
            client=MagicMock(),
        )

        context_block = _build_parent_context_block(ctx)
        assert context_block is not None
        assert "### Caller Notes" in context_block
        assert (
            "The database has 10M rows and indexing is required."
            in context_block
        )

    @pytest.mark.asyncio
    async def test_sub_agent_empty_context_block(
        self, test_user, make_chat_session
    ):
        """
        Verify _build_parent_context_block returns None when there is no
        context to forward.
        """
        session = make_chat_session(allowed_tools=["sub_agent"], messages=[])

        ctx = ToolContext(
            args=SubAgentArgs(
                agent_id=uuid.uuid4(),
                prompt="Standalone task",
                parent_context=None,
            ),
            user=test_user,
            user_message="Standalone task",
            session=session,
            user_files=[],
            app_settings=MagicMock(),
            client=MagicMock(),
        )

        context_block = _build_parent_context_block(ctx)
        assert context_block is None
