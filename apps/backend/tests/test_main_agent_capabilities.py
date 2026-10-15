import uuid
from unittest.mock import AsyncMock

import pytest
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import ToolUseAuthorization
from asterism.domains.agent.service import get_main_agent_profile
from asterism.domains.chat.schemas import Chat, ChatInfo
from asterism.domains.llm.schemas import ToolCall
from test_main_agent_defaults import main_agent_session as _main_agent_session

main_agent_session = _main_agent_session


@pytest.mark.asyncio
async def test_chat_permission_cannot_grant_unassigned_main_capability(main_agent_session, monkeypatch):
    profile = await get_main_agent_profile("user-a", main_agent_session)
    agent = Agent(
        profile=profile,
        user=AuthedUser(id="user-a", name="A", email="a@example.test", role="user"),
        session=Chat(info=ChatInfo(id=uuid.uuid4(), user_id="user-a", created_at=0, updated_at=0), messages=[]),
        allowed_tools=["web_fetch"],
    )
    invoke = AsyncMock()
    monkeypatch.setattr("asterism.domains.agent.agent.tool_registry.invoke_tool", invoke)
    call = ToolCall.model_validate(
        {
            "id": "unassigned",
            "type": "function",
            "function": {"name": "web_fetch", "arguments": "{}"},
        }
    )
    results = [result async for result in agent._run_tools("", [ToolUseAuthorization(tool=call, accept=True)])]
    assert len(results) == 1 and "not authorized" in results[0].content
    invoke.assert_not_called()
