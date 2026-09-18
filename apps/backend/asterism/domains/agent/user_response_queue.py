import asyncio
from typing import AsyncGenerator

from asterism.domains.agent.approval import ToolUseAuthorization
from asterism.domains.llm.schemas import ToolCall

__all__ = ["ToolUseAuthorization", "UserResponseQueue"]


class UserResponseQueue:
    def __init__(
        self,
        tools: list[ToolCall],
        has_permission: list[str],
    ):
        self._tools: list[ToolCall] = tools
        self._queue: asyncio.Queue[ToolUseAuthorization] = asyncio.Queue()
        self._has_permission: set[str] = set(has_permission)
        self._responded: set[str] = set()

        for tc in self._tools:
            if tc.function.name in self._has_permission:
                self._responded.add(tc.id)
                self._queue.put_nowait(
                    ToolUseAuthorization(
                        tool=tc,
                        accept=True,
                    )
                )

    @property
    def pending(self) -> list[ToolCall]:
        return [tc for tc in self._tools if tc.id not in self._responded]

    def respond(
        self,
        tool_call: ToolCall,
        accept: bool,
    ) -> None:
        if tool_call.id in self._responded:
            return

        self._responded.add(tool_call.id)
        self._queue.put_nowait(
            ToolUseAuthorization(
                tool=tool_call,
                accept=accept,
            )
        )

    async def wait(self) -> AsyncGenerator[ToolUseAuthorization, None]:
        for _ in range(len(self._tools)):
            yield await self._queue.get()
