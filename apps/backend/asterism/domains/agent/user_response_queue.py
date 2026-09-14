import asyncio
from dataclasses import dataclass
from typing import AsyncGenerator, Generator

from asterism.domains.llm.schemas import ToolCall


@dataclass
class ToolUseAuthorization:
    tool: ToolCall
    accept: bool


class UserResponseQueue:
    def __init__(self, tools: list[ToolCall], permissions: list[str]):
        self._tools: list[ToolCall] = tools
        self._queue: asyncio.Queue[ToolUseAuthorization] = asyncio.Queue()
        self._processed: set[str] = set()
        self._permissions: list[str] = permissions

    @property
    def pending(self) -> Generator[ToolCall, None, None]:
        for tc in self._tools:
            if tc.id in self._processed:
                continue
            if tc.function.name in self._permissions:
                self._queue.put_nowait(ToolUseAuthorization(tool=tc, accept=True))
                continue
            yield tc

    def respond(self, tool_call: ToolCall, accept: bool):
        if tool_call.id in self._processed:
            return

        self._queue.put_nowait(
            ToolUseAuthorization(
                tool=tool_call,
                accept=accept,
            )
        )

    async def wait(self) -> AsyncGenerator[ToolUseAuthorization, None]:
        while len(self._processed) < len(self._tools):
            response = await self._queue.get()
            self._processed.add(response.tool.id)
            yield response
