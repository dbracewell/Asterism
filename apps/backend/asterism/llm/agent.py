import asyncio
from enum import StrEnum, auto
from typing import AsyncGenerator

from pydantic import BaseModel, Field

from asterism.common import (
    AgentProfile,
    AuthedUser,
    ToolCall,
    ToolResult,
)
from asterism.registries import tool_registry
from asterism.schemas import LLMMessage
from asterism.utils.log import get_logger

from .client import LLMClient, LLMEvent, LLMEventType


class AgentEventType(StrEnum):
    START = auto()
    COMPLETE = auto()
    TOOL_COMPLETE = auto()
    ERROR = auto()
    DELTA = auto()


class AgentEvent(BaseModel):
    type: AgentEventType
    content: str = Field(default="")
    thinking: str = Field(default="")
    tool_calls: list[ToolCall] = Field(default_factory=list[ToolCall])
    tool_results: list[ToolResult] = Field(default_factory=list[ToolResult])
    total_tokens: int = Field(default=0)

    def has_tool_calls(self) -> bool:
        return len(self.tool_calls) > 0

    def has_tool_results(self) -> bool:
        return len(self.tool_results) > 0


class Agent:
    def __init__(
        self,
        profile: AgentProfile,
        user: AuthedUser,
    ) -> None:
        self.profile = profile
        self.client: LLMClient | None = None
        self.max_steps = profile.max_steps
        self.user = user
        self.logger = get_logger(
            f"Agent-{profile.name}-[{len(profile.tools)} tools])"
        )

    async def _get_client(self) -> LLMClient:
        if self.client:
            return self.client
        self.client = await self.profile.model.get_client()
        return self.client

    async def _run_tools(
        self,
        user_message: str,
        tool_calls: list[ToolCall],
    ) -> AsyncGenerator[ToolResult, None]:
        tasks = [
            tool_registry.invoke_tool(
                tool_call=tc,
                user=self.user,
                client=await self._get_client(),
                user_message=user_message or "",
            )
            for tc in tool_calls
        ]
        responses: list[ToolResult] = list(await asyncio.gather(*tasks))
        for response in responses:
            yield response

    async def run(
        self,
        messages: list[LLMMessage],
    ) -> AsyncGenerator[AgentEvent, None]:
        client = await self._get_client()

        if self.profile.system_prompt and messages[0].role != "system":
            messages.insert(0, LLMMessage.system(self.profile.system_prompt))

        last_user_message = messages[-1]
        for step in range(self.max_steps):
            last_event: LLMEvent | None = None

            # Only allow tools if there are enough
            # steps to respond to them
            tools: list[str] = []
            if step + 1 < self.max_steps:
                tools = self.profile.tools

            async for event in client.chat(
                messages=messages,
                tools=tools,
                **self.profile.chat_parameters,
            ):
                last_event = event

                match event.type:
                    case LLMEventType.ERROR:
                        yield AgentEvent(
                            type=AgentEventType.ERROR,
                            content=str(event.exception),
                        )
                        return
                    case LLMEventType.START:
                        yield AgentEvent(type=AgentEventType.START)
                    case LLMEventType.TEXT_DELTA | LLMEventType.THINKING_DELTA:
                        yield AgentEvent(
                            type=AgentEventType.DELTA,
                            content=event.content,
                            thinking=event.thinking,
                        )
                    case LLMEventType.COMPLETE:
                        messages.append(
                            LLMMessage.assistant(
                                content=last_event.content or "",
                                token_count=last_event.total_tokens or 0,
                                tool_calls=last_event.tool_calls,
                            )
                        )
                        self.logger.info(
                            f"Event(type={event.type}, "
                            f"content={event.content[:100]} "
                            f"has_tools={bool(event.tool_calls)})"
                        )
                        tool_results: list[ToolResult] = []
                        if event.tool_calls:
                            async for response in self._run_tools(
                                user_message=last_user_message.content,
                                tool_calls=event.tool_calls,
                            ):
                                self.logger.info(
                                    "ToolResult(tool="
                                    f"{response.tool_call.function.name}, "
                                    f"args={response.tool_call.function.arguments})"
                                )
                                messages.append(
                                    LLMMessage.tool_call_result(response)
                                )
                                tool_results.append(response)
                        else:
                            yield AgentEvent(
                                type=AgentEventType.COMPLETE,
                                content=event.content,
                                thinking=event.thinking,
                                tool_results=tool_results,
                                tool_calls=event.tool_calls or [],
                                total_tokens=event.total_tokens,
                            )

                        if event.finish_reason == "stop":
                            return
