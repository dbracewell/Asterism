from __future__ import annotations

import asyncio
import re
import uuid
from logging import Logger
from typing import AsyncGenerator

import asterism.domains.settings.service as settings_service
from asterism.common.concurrency import AsyncAtomic
from asterism.common.log import get_logger
from asterism.core.config import config
from asterism.core.exceptions import BadDataException
from asterism.core.schemas import AuthedUser
from asterism.domains.chat.schemas import Chat
from asterism.domains.llm.client import LLMClient
from asterism.domains.llm.schemas import (
    LLMClientProtocol,
    LLMEventType,
    LLMMessage,
    ToolResult,
)
from asterism.domains.settings.schemas import LlmWithProvider
from asterism.domains.tools.registry import tool_registry

from .approval import (
    AllowlistApprovalPolicy,
    ToolApprovalPolicy,
    ToolUseAuthorization,
)
from .schemas import AgentEvent, AgentEventType, AgentProfile


class Agent:
    def __init__(
        self,
        profile: AgentProfile,
        user: AuthedUser,
        session: Chat,
        logger: Logger | None = None,
        allowed_tools: list[str] | None = None,
        approval_policy: ToolApprovalPolicy | None = None,
        call_stack: list[uuid.UUID] | None = None,
    ) -> None:
        self.profile = profile
        self.max_steps = profile.max_steps
        self.user = user
        self.session = session
        self.logger = logger or get_logger(f"Agent({self.profile.name})")
        self._client: AsyncAtomic[LLMClientProtocol | None] = AsyncAtomic(None)
        self.allowed_tools = (
            allowed_tools
            if allowed_tools is not None
            else config.default_allowed_tools
        )
        self._approval_policy: ToolApprovalPolicy = (
            approval_policy or AllowlistApprovalPolicy()
        )
        if call_stack is not None:
            self.call_stack = list(call_stack)
        elif self.profile.id is not None:
            self.call_stack = [self.profile.id]
        else:
            self.call_stack = []

    async def _get_client(self) -> LLMClientProtocol:
        async with self._client as (get, set):
            client: LLMClientProtocol | None = get()
            if client:
                return client

            if not self.profile.model_id:
                raise BadDataException(
                    "Agent profile does not have a model_id set. "
                    "Cannot create LLM client."
                )
            model_info: LlmWithProvider = (
                await settings_service.get_model_and_provider(
                    model_id=self.profile.model_id,
                )
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
        auths: list[ToolUseAuthorization],
    ) -> AsyncGenerator[ToolResult, None]:
        tasks = [
            tool_registry.invoke_tool(
                tool_call=auth.tool,
                user=self.user,
                session=self.session,
                client=await self._get_client(),
                user_message=user_message or "",
                call_stack=self.call_stack,
            )
            for auth in auths
            if auth.accept
        ]
        responses: list[ToolResult] = list(await asyncio.gather(*tasks))
        for response in responses:
            yield response
        for auth in filter(lambda x: not x.accept, auths):
            yield ToolResult(
                content=f"Tool '{auth.tool.id} - {auth.tool.function.name}' was not authorized for use by the user. You should not attempt to call again and should proceed with answering the user's question",  # noqa: E501
                raw_result=None,
                is_empty=True,
                tool_call=auth.tool,
            )

    async def _build_system_prompt(self) -> str | None:
        base_prompt = self.profile.system_prompt or ""

        if "sub_agent" in (self.profile.tools or []):
            from .service import get_user_agents

            agent_profiles = await get_user_agents(self.user.id)
            agent_info = []
            for profile in agent_profiles.agents.values():
                if profile.id == self.profile.id or profile.sub_agent is False:
                    continue

                agent_info.append(
                    f"- id: {profile.id} (name: {profile.name}) - {profile.description}"  # noqa: E501
                )

            base_prompt = (
                f"{base_prompt}\n\n"
                "You have access to a tool called 'sub_agent' "
                "that allows you to delegate tasks to a sub-agent. "
                "Use this tool when you need to break down complex "
                "tasks or when you want to delegate work to another agent. "
                "Make sure that if the sub agent generates information needed "
                "to be seen by the user that you output that information in your "  # noqa: E501
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
        for step in range(self.max_steps):
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
                                content=event.content,
                                token_count=event.total_tokens or 0,
                                tool_calls=event.tool_calls,
                            )
                        )
                        self.logger.debug(
                            f"Event(type={event.type}, "
                            f"content={event.content[:100]} "
                            f"tools={[f'{tc.function.name}({tc.function.arguments})' for tc in event.tool_calls or []]} "  # noqa: E501
                        )

                        tool_results: list[ToolResult] = []
                        if event.tool_calls:
                            yield AgentEvent(
                                type=AgentEventType.TOOL_CALL,
                                tool_calls=event.tool_calls,
                            )

                            auths = await self._approval_policy.authorize(
                                event.tool_calls,
                                self.allowed_tools,
                            )

                            async for response in self._run_tools(
                                user_message=last_user_message.content,
                                auths=auths,
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
                            type=AgentEventType.COMPLETE,
                            content=event.content,
                            thinking=event.thinking,
                            tool_results=tool_results,
                            tool_calls=event.tool_calls or [],
                            total_tokens=event.total_tokens,
                        )

                        if event.finish_reason == "stop":
                            return
