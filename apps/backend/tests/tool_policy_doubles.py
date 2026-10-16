"""Policy doubles for isolated streaming/approval tests; live policy has integration coverage."""

import uuid

import pytest
from asterism.domains.agent.execution_scope import ExecutionScope, ModelIdentity
from asterism.domains.tools.context import ContextToolScope


class _AnyTarget(frozenset):
    """Isolated tests patch live target validation, so every target counts as eligible."""

    def __contains__(self, item):
        return True


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
        if self.execution_scope is None:
            self.execution_scope = ExecutionScope(
                user_id=self.user.id,
                user_profile_id=None,
                agent_id=self.profile.id,
                is_sub_agent=self.profile.sub_agent,
                chat_id=self.session.info.id,
                project_id=self.tool_scope.project_id,
                selected_model=None,
                executed_model=ModelIdentity(id=self.tool_scope.model_id),
                eligible_sub_agent_ids=_AnyTarget(),
                effective_internal_tools=frozenset({"sub_agent", "search_knowledge"}),
                active_branch_message_ids=(),
                configuration_revision=1,
                prompt_revision=None,
                allowed_file_ids=self.tool_scope.file_ids,
                file_provenance=(),
            )
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
