from __future__ import annotations

import asyncio
import re
from enum import StrEnum, auto
from typing import AsyncGenerator

from pydantic import BaseModel, Field

import asterism.domains.settings.service as settings_service
from asterism.common.concurrency import AsyncAtomic
from asterism.common.log import get_logger
from asterism.core.schemas import AuthedUser
from asterism.domains.llm.client import LLMClient
from asterism.domains.llm.schemas import (
    LLMClientProtocol,
    LLMEvent,
    LLMEventType,
    LLMMessage,
    ToolCall,
    ToolResult,
)
from asterism.domains.tools.registry import tool_registry

from .schemas import AgentProfile


class AgentEventType(StrEnum):
    START = auto()
    COMPLETE = auto()
    TOOL_CALL = auto()
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

        async with self._client as (get, set):
            client = get()
            if client:
                return client

            model_info = await settings_service.get_model_and_provider(
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

    async def _build_system_prompt(self) -> str | None:
        base_prompt = self.profile.system_prompt or ""

        if "sub_agent" in (self.profile.tools or []):
            from .service import get_user_agents

            agent_profiles = await get_user_agents(self.user.id)
            agent_info = []
            for profile in agent_profiles.agents.values():
                if profile.id == self.profile.id:
                    continue

                agent_info.append(
                    f"- id: {profile.id} (name: {profile.name}) - "
                    f"{profile.description}"
                )

            base_prompt = (
                f"{base_prompt}\n\n"
                "You have access to a tool called 'sub_agent' "
                "that allows you to delegate tasks to a sub-agent. "
                "Use this tool when you need to break down complex "
                "tasks or when you want to delegate work to another agent."
                "Make sure that if the sub agent generates information needed "
                "to be seen the user that output that information in your"
                "response. "
                "Sub Agents:"
                f"\n{'\n'.join(agent_info)}"
            )

        base_prompt = base_prompt.strip()
        if base_prompt == "":
            return None

        return base_prompt

    async def run(
        self,
        messages: list[LLMMessage],
    ) -> AsyncGenerator[AgentEvent, None]:
        client: LLMClientProtocol = await self._get_client()

        if messages[0].role != "system":
            system_prompt = await self._build_system_prompt()
            if system_prompt:
                messages.insert(0, LLMMessage.system(system_prompt))

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
                            yield AgentEvent(
                                type=AgentEventType.TOOL_CALL,
                                tool_calls=event.tool_calls or [],
                            )
                            async for response in self._run_tools(
                                user_message=last_user_message.content,
                                tool_calls=event.tool_calls,
                            ):
                                self.logger.debug(
                                    f"{response.tool_call.function.name}("
                                    f"{response.tool_call.function.arguments})"
                                    f"=>'{re.sub(r'\s+', ' ', response.content[:64])}...'"  # noqa: E501
                                )
                                messages.append(
                                    LLMMessage.tool_call_result(response)
                                )
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
