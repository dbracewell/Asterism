from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Awaitable, Callable, Protocol

from asterism.domains.llm.schemas import ToolCall

if TYPE_CHECKING:
    from asterism.domains.agent.user_response_queue import (
        UserResponseQueue,
    )


@dataclass
class ToolUseAuthorization:
    """Result of a tool-use authorization decision."""

    tool: ToolCall
    accept: bool


class ToolApprovalPolicy(Protocol):
    """
    Protocol for tool-use authorization strategies.

    Implementations decide which tool calls are approved and which
    are rejected before the agent executes them.
    """

    async def authorize(
        self,
        tools: list[ToolCall],
        permissions: list[str],
    ) -> list[ToolUseAuthorization]:
        """
        Authorize a batch of tool calls.

        Args:
            tools: The tool calls requested by the LLM.
            permissions: Tool names the agent is allowed to execute.

        Returns:
            A list of authorization decisions, one per tool call.
        """
        ...


class AllowlistApprovalPolicy:
    """
    Auto-approve tools whose name is in the permissions list,
    reject all others. No async coordination needed.
    """

    async def authorize(
        self,
        tools: list[ToolCall],
        permissions: list[str],
    ) -> list[ToolUseAuthorization]:
        permission_set = set(permissions)
        return [
            ToolUseAuthorization(
                tool=tc,
                accept=tc.function.name in permission_set,
            )
            for tc in tools
        ]


class InteractiveApprovalPolicy:
    """
    Auto-approve permitted tools; for tools not in the permissions
    list, invoke a callback to request external authorization
    (e.g. from a user via WebSocket) and await decisions.

    The callback receives the list of tools needing approval and
    the UserResponseQueue to call ``respond()`` on.
    """

    def __init__(
        self,
        on_pending: Callable[
            [list[ToolCall], UserResponseQueue], Awaitable[None]
        ],
    ) -> None:
        self._on_pending = on_pending

    async def authorize(
        self,
        tools: list[ToolCall],
        permissions: list[str],
    ) -> list[ToolUseAuthorization]:
        from asterism.domains.agent.user_response_queue import (
            UserResponseQueue,
        )

        queue = UserResponseQueue(tools=tools, has_permission=permissions)

        # Collect tools that need external approval (pending
        # also auto-enqueues permitted tools as a side effect).
        pending = list(queue.pending)
        if pending:
            # Fire the callback — the caller is responsible for
            # calling queue.respond() for each pending tool.
            await self._on_pending(pending, queue)

        auths: list[ToolUseAuthorization] = []
        async for auth in queue.wait():
            auths.append(auth)
        return auths
