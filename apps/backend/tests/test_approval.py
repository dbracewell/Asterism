import asyncio

import pytest
from asterism.domains.agent.approval import (
    AllowlistApprovalPolicy,
    InteractiveApprovalPolicy,
    ToolUseAuthorization,
)
from asterism.domains.agent.user_response_queue import UserResponseQueue
from asterism.domains.llm.schemas import Function, ToolCall


def _make_tool_call(name: str, tool_id: str = "") -> ToolCall:
    """Create a ToolCall with the given function name."""
    return ToolCall(
        id=tool_id or f"call_{name}",
        function=Function(name=name, arguments="{}"),
    )


# ──────────────────────────────────────────────
# AllowlistApprovalPolicy
# ──────────────────────────────────────────────


class TestAllowlistApprovalPolicy:
    @pytest.mark.asyncio
    async def test_all_approved_when_in_permissions(self):
        policy = AllowlistApprovalPolicy()
        tools = [_make_tool_call("search"), _make_tool_call("calculator")]
        result = await policy.authorize(tools, ["search", "calculator"])
        assert all(auth.accept for auth in result)
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_all_rejected_when_not_in_permissions(self):
        policy = AllowlistApprovalPolicy()
        tools = [_make_tool_call("shell"), _make_tool_call("delete_file")]
        result = await policy.authorize(tools, ["search"])
        assert not any(auth.accept for auth in result)
        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_mixed_approval(self):
        policy = AllowlistApprovalPolicy()
        tools = [
            _make_tool_call("search"),
            _make_tool_call("shell"),
            _make_tool_call("calculator"),
        ]
        result = await policy.authorize(tools, ["search", "calculator"])
        assert result[0].accept is True
        assert result[0].tool.function.name == "search"
        assert result[1].accept is False
        assert result[1].tool.function.name == "shell"
        assert result[2].accept is True
        assert result[2].tool.function.name == "calculator"

    @pytest.mark.asyncio
    async def test_empty_tools(self):
        policy = AllowlistApprovalPolicy()
        result = await policy.authorize([], ["search"])
        assert result == []

    @pytest.mark.asyncio
    async def test_empty_permissions(self):
        policy = AllowlistApprovalPolicy()
        tools = [_make_tool_call("search")]
        result = await policy.authorize(tools, [])
        assert len(result) == 1
        assert result[0].accept is False

    @pytest.mark.asyncio
    async def test_preserves_tool_reference(self):
        policy = AllowlistApprovalPolicy()
        tool = _make_tool_call("search")
        result = await policy.authorize([tool], ["search"])
        assert result[0].tool is tool


# ──────────────────────────────────────────────
# InteractiveApprovalPolicy
# ──────────────────────────────────────────────


class TestInteractiveApprovalPolicy:
    @pytest.mark.asyncio
    async def test_all_permitted_skips_callback(self):
        """When all tools are pre-permitted, callback is never called."""
        callback_called = False

        async def on_pending(
            tools: list[ToolCall], queue: UserResponseQueue
        ) -> None:
            nonlocal callback_called
            callback_called = True

        policy = InteractiveApprovalPolicy(on_pending=on_pending)
        tools = [_make_tool_call("search"), _make_tool_call("calculator")]
        result = await policy.authorize(tools, ["search", "calculator"])

        assert not callback_called
        assert len(result) == 2
        assert all(auth.accept for auth in result)

    @pytest.mark.asyncio
    async def test_callback_invoked_for_unpermitted_tools(self):
        """Callback is invoked and approves unpermitted tools."""
        received_tools: list[ToolCall] = []

        async def on_pending(
            tools: list[ToolCall], queue: UserResponseQueue
        ) -> None:
            received_tools.extend(tools)
            for tool in tools:
                queue.respond(tool, accept=True)

        policy = InteractiveApprovalPolicy(on_pending=on_pending)
        tools = [_make_tool_call("shell")]
        result = await policy.authorize(tools, [])

        assert len(received_tools) == 1
        assert received_tools[0].function.name == "shell"
        assert len(result) == 1
        assert result[0].accept is True

    @pytest.mark.asyncio
    async def test_callback_rejects_tool(self):
        """Callback can reject tools."""

        async def on_pending(
            tools: list[ToolCall], queue: UserResponseQueue
        ) -> None:
            for tool in tools:
                queue.respond(tool, accept=False)

        policy = InteractiveApprovalPolicy(on_pending=on_pending)
        tools = [_make_tool_call("shell")]
        result = await policy.authorize(tools, [])

        assert len(result) == 1
        assert result[0].accept is False

    @pytest.mark.asyncio
    async def test_mixed_permitted_and_callback(self):
        """Permitted tools are auto-approved, unpermitted go to callback."""

        async def on_pending(
            tools: list[ToolCall], queue: UserResponseQueue
        ) -> None:
            for tool in tools:
                queue.respond(tool, accept=True)

        policy = InteractiveApprovalPolicy(on_pending=on_pending)
        tools = [
            _make_tool_call("search"),
            _make_tool_call("shell"),
        ]
        result = await policy.authorize(tools, ["search"])

        assert len(result) == 2
        # search is auto-approved (in permissions)
        search_auth = next(
            a for a in result if a.tool.function.name == "search"
        )
        assert search_auth.accept is True
        # shell goes through callback
        shell_auth = next(a for a in result if a.tool.function.name == "shell")
        assert shell_auth.accept is True

    @pytest.mark.asyncio
    async def test_callback_with_delayed_response(self):
        """Callback can respond asynchronously (simulating user delay)."""

        async def on_pending(
            tools: list[ToolCall], queue: UserResponseQueue
        ) -> None:
            # Simulate a brief delay before responding
            await asyncio.sleep(0.01)
            for tool in tools:
                queue.respond(tool, accept=True)

        policy = InteractiveApprovalPolicy(on_pending=on_pending)
        tools = [_make_tool_call("shell")]
        result = await policy.authorize(tools, [])

        assert len(result) == 1
        assert result[0].accept is True


# ──────────────────────────────────────────────
# UserResponseQueue (internal implementation)
# ──────────────────────────────────────────────


class TestUserResponseQueue:
    def test_pending_auto_approves_permitted_tools(self):
        tools = [_make_tool_call("search"), _make_tool_call("shell")]
        queue = UserResponseQueue(tools=tools, has_permission=["search"])
        pending = list(queue.pending)
        # Only shell should be pending (search is auto-approved)
        assert len(pending) == 1
        assert pending[0].function.name == "shell"

    def test_pending_is_idempotent(self):
        tools = [_make_tool_call("search"), _make_tool_call("shell")]
        queue = UserResponseQueue(tools=tools, has_permission=["search"])
        # Repeated calls to pending should return the exact same pending tools
        assert [tc.function.name for tc in queue.pending] == ["shell"]
        assert [tc.function.name for tc in queue.pending] == ["shell"]

    def test_respond_ignores_already_processed(self):
        tool = _make_tool_call("search")
        queue = UserResponseQueue(tools=[tool], has_permission=["search"])
        # tool is already auto-approved on init; respond should be a no-op
        queue.respond(tool, accept=False)
        assert queue._queue.qsize() == 1

    @pytest.mark.asyncio
    async def test_wait_yields_all_authorizations(self):
        tools = [_make_tool_call("search"), _make_tool_call("shell")]
        queue = UserResponseQueue(tools=tools, has_permission=["search"])
        # Respond to the pending one
        pending = list(queue.pending)
        for tool in pending:
            queue.respond(tool, accept=True)

        auths: list[ToolUseAuthorization] = []
        async for auth in queue.wait():
            auths.append(auth)

        assert len(auths) == 2
