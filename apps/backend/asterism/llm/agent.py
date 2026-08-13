from __future__ import annotations

import asyncio
import re
from enum import StrEnum, auto
from typing import AsyncGenerator

from pydantic import BaseModel, Field

from asterism.common import (
    AuthedUser,
    LLMClientProtocol,
    LLMEvent,
    LLMEventType,
    LLMMessage,
    ToolCall,
    ToolResult,
)
from asterism.common.atomic import AsyncAtomic
from asterism.schemas import AgentProfile
from asterism.utils.log import get_logger

from .client import LLMClient


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
        self.max_steps = profile.max_steps
        self.user = user
        self.logger = get_logger(f"Agent-{profile.name}")
        self._client: AsyncAtomic[LLMClientProtocol | None] = AsyncAtomic(None)

    async def _get_client(self) -> LLMClientProtocol:
        from asterism.repositories import settings_repository

        async with self._client as (get, set):
            client = get()
            if client:
                return client

            model_info = await settings_repository.get_model_and_provider(
                model_id=self.profile.model_id,
            )
            client = LLMClient(
                api_key=model_info.provider.api_key,
                base_url=model_info.provider.base_url,
                model_name=model_info.name,
            )
            set(client)
            return client

    async def _run_tools(
        self,
        user_message: str,
        tool_calls: list[ToolCall],
    ) -> AsyncGenerator[ToolResult, None]:
        from asterism.registries import tool_registry

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
        last_thinking: str | None = None
        for step in range(self.max_steps):
            last_event: LLMEvent | None = None

            # Only allow tools if there are enough
            # steps to respond to them
            tools: list[str] | None = []
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
                        if not messages[-1].tool_calls:
                            yield AgentEvent(type=AgentEventType.START)
                    case LLMEventType.TEXT_DELTA | LLMEventType.THINKING_DELTA:
                        yield AgentEvent(
                            type=AgentEventType.DELTA,
                            content=event.content,
                            thinking=event.thinking or last_thinking or "",
                        )
                    case LLMEventType.COMPLETE:
                        messages.append(
                            LLMMessage.assistant(
                                content=last_event.content or "",
                                token_count=last_event.total_tokens or 0,
                                tool_calls=last_event.tool_calls,
                            )
                        )
                        self.logger.debug(
                            f"Event(type={event.type}, "
                            f"content={event.content[:100]} "
                            f"tools={[f'{tc.function.name}({tc.function.arguments})' for tc in event.tool_calls or []]} "  # noqa: E501
                        )

                        if event.tool_calls:
                            tool_results: list[ToolResult] = []
                            async for response in self._run_tools(
                                user_message=last_user_message.content,
                                tool_calls=event.tool_calls,
                            ):
                                self.logger.debug(
                                    f"{response.tool_call.function.name}("
                                    f"{response.tool_call.function.arguments})"
                                    f"=>'{re.sub(r'\s+', ' ', response.content[:64])}...'"  # noqa: E501
                                )
                                messages.append(LLMMessage.tool_call_result(response))
                                tool_results.append(response)
                            yield AgentEvent(
                                type=AgentEventType.TOOL_COMPLETE,
                                content=event.content,
                                thinking=event.thinking or last_thinking or "",
                                tool_results=tool_results,
                                tool_calls=event.tool_calls or [],
                                total_tokens=event.total_tokens,
                            )
                        else:
                            yield AgentEvent(
                                type=AgentEventType.COMPLETE,
                                content=event.content,
                                thinking=event.thinking or last_thinking or "",
                                tool_results=[],
                                tool_calls=event.tool_calls or [],
                                total_tokens=event.total_tokens,
                            )

                        last_thinking = None

                        if event.finish_reason == "stop":
                            return
