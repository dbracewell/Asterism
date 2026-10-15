"""Policy doubles for isolated streaming/approval tests; live policy has integration coverage."""

import uuid

import pytest
from asterism.domains.tools.context import ContextToolScope


@pytest.fixture
def isolated_tool_policy(monkeypatch):
    async def resolve(self, *, reset=False):
        if self.tool_scope is None:
            self.tool_scope = ContextToolScope(
                user_id=self.user.id,
                chat_id=self.session.info.id,
                project_id=uuid.uuid4(),
                caller_agent_id=self.profile.id,
                model_id=self.model_id or uuid.uuid4(),
                file_ids=frozenset(),
                delegation=self.delegation_scope,
            )
        self.effective_tools = list(self.profile.tools or [])
        return self.effective_tools

    async def require(*, name, user_id, chat_id, scope):
        return scope or ContextToolScope(
            user_id=user_id,
            chat_id=chat_id,
            project_id=uuid.uuid4(),
            caller_agent_id=uuid.uuid4(),
            model_id=uuid.uuid4(),
            file_ids=frozenset(),
            delegation=None,
        )

    monkeypatch.setattr("asterism.domains.agent.agent.Agent.resolve_tools", resolve)
    monkeypatch.setattr("asterism.domains.chat.tool_policy.require_internal_tool", require)
