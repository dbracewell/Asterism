from __future__ import annotations

import asyncio
import inspect
import re
import uuid
from logging import Logger
from typing import AsyncGenerator, Awaitable, Callable, cast

import asterism.domains.settings.service as settings_service
from asterism.common.log import get_logger
from asterism.core.config import config
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.core.schemas import AuthedUser
from asterism.domains.chat.schemas import Chat, MessageExecution
from asterism.domains.llm.client import LLMClient
from asterism.domains.llm.schemas import (
    ContentPart,
    LLMClientProtocol,
    LLMEventType,
    LLMMessage,
    ToolResult,
)
from asterism.domains.settings.schemas import LlmWithProvider
from asterism.domains.tools.catalog import INTERNAL_TOOL_NAMES, configurable_tools
from asterism.domains.tools.context import ContextToolScope
from asterism.domains.tools.registry import tool_registry

from .approval import (
    AllowlistApprovalPolicy,
    ToolApprovalPolicy,
    ToolUseAuthorization,
)
from .delegation_scope import DelegationScope
from .schemas import (
    AgentEvent,
    AgentEventType,
    AgentProfile,
    SubAgentEventEnvelope,
)


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
        event_sink: Callable[[SubAgentEventEnvelope], Awaitable[None] | None] | None = None,
        user_files: list[str] | None = None,
        parent_message_id: uuid.UUID | None = None,
        model_id: uuid.UUID | None = None,
        delegation_scope: DelegationScope | None = None,
        tool_scope: ContextToolScope | None = None,
        authorization_check: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        if profile.sub_agent and model_id is not None and model_id != profile.model_id:
            raise BadDataException("Sub-agent model binding cannot be overridden")
        self.tool_scope = tool_scope
        self.effective_tools: list[str] = []
        self._delegation_available = False
        self.delegation_scope = delegation_scope
        self.authorization_check = authorization_check
        self.execution: MessageExecution | None = None
        self.model_id = profile.model_id if profile.sub_agent else model_id
        self.profile: AgentProfile = profile
        self.max_steps: int = profile.max_steps
        self.user: AuthedUser = user
        self.session: Chat = session
        self.logger: Logger = logger or get_logger("Agent")
        self._client: LLMClientProtocol | None = None
        configured_tools = allowed_tools if allowed_tools is not None else config.default_allowed_tools
        self.allowed_tools: list[str] = configurable_tools(configured_tools)
        self._approval_policy: ToolApprovalPolicy = approval_policy or AllowlistApprovalPolicy()
        self.event_sink: Callable[[SubAgentEventEnvelope], Awaitable[None] | None] | None = event_sink
        self.user_files: list[str] = list(user_files) if user_files else []
        self.parent_message_id: uuid.UUID | None = parent_message_id
        self.messages: list[LLMMessage] = []
        if call_stack is not None:
            self.call_stack: list[uuid.UUID] = list(call_stack)
        elif self.profile.id is not None:
            self.call_stack = [self.profile.id]
        else:
            self.call_stack = []

    async def refresh_main_configuration(self) -> None:
        from .service import get_main_agent_profile

        if self.profile.sub_agent:
            raise BadDataException("A chat must use the main configuration")
        self.profile = await get_main_agent_profile(self.user.id)
        self.max_steps = self.profile.max_steps
        model_id = self.session.info.selected_model_id
        if model_id != self.model_id:
            self._client = None
        self.model_id = model_id

    async def prepare_execution(self, message_id: uuid.UUID, *, restart: bool = False) -> MessageExecution:
        from asterism.domains.chat.execution import prepare_execution

        if self.profile.sub_agent:
            raise BadDataException("Sub-agents retain their fixed model binding")
        execution = await prepare_execution(
            user_id=self.user.id,
            chat_id=self.session.info.id,
            message_id=message_id,
            restart=restart,
        )
        self.apply_execution(execution)
        return execution

    def apply_execution(self, execution: MessageExecution) -> None:
        self._client = None
        self.execution = execution
        self.model_id = execution.model.id
        self.profile = AgentProfile.model_validate(
            {**execution.configuration.model_dump(exclude_none=True), "sub_agent": False, "model_id": None},
        )
        self.max_steps = self.profile.max_steps

    async def _get_client(self) -> LLMClientProtocol:
        if self.model_id is None:
            raise BadDataException("Choose an available chat model before generating")
        try:
            model_info: LlmWithProvider = await settings_service.get_model_and_provider(model_id=self.model_id)
        except NotFoundException as error:
            action = (
                "edit the sub-agent definition"
                if self.profile.sub_agent
                else "choose an available chat model and regenerate"
            )
            raise BadDataException(f"Execution model is unavailable; {action}") from error
        if self.execution is not None and (
            model_info.name != self.execution.model.name
            or model_info.provider.id != self.execution.model.provider_id
            or model_info.supports_tools != self.execution.model.supports_tools
            or model_info.supports_vision != self.execution.model.supports_vision
            or model_info.context_window != self.execution.model.context_window
        ):
            raise BadDataException("Recorded model identity changed; regenerate using the current selection")
        if self._client is not None:
            return self._client

        client = LLMClient(
            api_key=model_info.provider.api_key,
            base_url=model_info.provider.base_url,
            model_name=model_info.name,
        )
        self._client = client
        return client

    async def _run_tools(
        self,
        user_message: str,
        auths: list[ToolUseAuthorization],
        event_sink: Callable[[SubAgentEventEnvelope], Awaitable[None] | None] | None = None,
    ) -> AsyncGenerator[ToolResult, None]:
        if self.authorization_check:
            await self.authorization_check()
        configured = set(await self.resolve_tools())
        auths = [
            ToolUseAuthorization(tool=auth.tool, accept=auth.accept and auth.tool.function.name in configured)
            for auth in auths
        ]

        async def authorize_internal(name: str) -> None:
            from asterism.domains.chat.tool_policy import require_internal_tool

            await require_internal_tool(
                name=name, user_id=self.user.id, chat_id=self.session.info.id, scope=self.tool_scope
            )

        tasks = [
            tool_registry.invoke_tool(
                tool_call=auth.tool,
                user=self.user,
                session=self.session,
                client=await self._get_client(),
                user_message=user_message or "",
                user_files=self.user_files,
                call_stack=self.call_stack,
                event_sink=event_sink,
                parent_message_id=self.parent_message_id,
                delegation_scope=self.delegation_scope,
                tool_scope=self.tool_scope,
                authorize_internal=authorize_internal,
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

    async def resolve_tools(self, *, reset: bool = False) -> list[str]:
        from asterism.domains.chat.tool_policy import resolve_effective_tools

        self.effective_tools, self.tool_scope = await resolve_effective_tools(
            user_id=self.user.id,
            chat_id=self.session.info.id,
            profile=self.profile,
            model_id=self.model_id,
            ceiling=None if reset else self.tool_scope,
        )
        self.delegation_scope = self.tool_scope.delegation if self.tool_scope else None
        return self.effective_tools

    async def _build_system_prompt(self) -> str | None:
        base_prompt = self.profile.system_prompt or ""

        await self.resolve_tools(reset=not self.profile.sub_agent)
        if "sub_agent" in self.effective_tools:
            from asterism.domains.chat.delegation import eligible_delegation_targets

            agent_profiles = await eligible_delegation_targets(
                user_id=self.user.id,
                chat_id=self.session.info.id,
                scope=self.delegation_scope,
            )
            self._delegation_available = bool(agent_profiles)
            agent_info = []
            for profile in agent_profiles:
                if profile.id == self.profile.id or profile.sub_agent is False:
                    continue

                agent_info.append(
                    f"- id: {profile.id} (name: {profile.name}) - {profile.description}",  # noqa: E501
                )

            if not agent_info:
                return base_prompt.strip() or None

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
        if self.authorization_check:
            await self.authorization_check()
        client: LLMClientProtocol = await self._get_client()

        messages = list(messages)
        if not messages:
            messages = [LLMMessage.user("")]

        self.messages = messages

        system_prompt = await self._build_system_prompt()
        if system_prompt:
            if not messages or messages[0].content != system_prompt:
                messages.insert(0, LLMMessage.system(system_prompt))

        last_user_message: LLMMessage = messages[-1]
        for step in range(self.max_steps):
            if self.authorization_check:
                await self.authorization_check()
            # Only allow tools if there are enough
            # steps to respond to them
            tools: list[str] | None = []
            if step + 1 < self.max_steps:
                tools = await self.resolve_tools()

            if tools and not self._delegation_available:
                tools = [name for name in tools if name != "sub_agent"]

            async for event in client.chat(
                messages=messages,
                tools=tools,
                **self.profile.chat_parameters,
            ):
                if self.authorization_check:
                    await self.authorization_check()
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
                                tool_calls=event.tool_calls,
                            ),
                        )
                        self.logger.debug(
                            f"Event(type={event.type}, "
                            f"content={event.content[:100]} "
                            f"tools={[f'{tc.function.name}({tc.function.arguments})' for tc in event.tool_calls or []]} ",  # noqa: E501
                        )

                        tool_results: list[ToolResult] = []
                        if event.tool_calls:
                            yield AgentEvent(
                                type=AgentEventType.TOOL_CALL,
                                tool_calls=event.tool_calls,
                            )

                            auths = await self._approval_policy.authorize(
                                event.tool_calls,
                                sorted(set(self.allowed_tools) | (set(self.effective_tools) & INTERNAL_TOOL_NAMES)),
                            )

                            sub_agent_queue: asyncio.Queue[SubAgentEventEnvelope] = asyncio.Queue()

                            async def _internal_sink(envelope: SubAgentEventEnvelope) -> None:
                                await sub_agent_queue.put(envelope)
                                if self.event_sink:
                                    res = self.event_sink(envelope)
                                    if inspect.isawaitable(res):
                                        await res

                            async def _collect_tool_results() -> list[ToolResult]:
                                collected: list[ToolResult] = []

                                last_message = ""
                                if isinstance(last_user_message.content, str):
                                    last_message = last_user_message.content
                                else:
                                    parts = cast(list[ContentPart], last_user_message.content)
                                    part = next((p for p in parts if p.type == "text"), None)
                                    last_message = part.text if part else ""

                                async for resp in self._run_tools(
                                    user_message=last_message,
                                    auths=auths,
                                    event_sink=_internal_sink,
                                ):
                                    collected.append(resp)

                                return collected

                            tool_task = asyncio.create_task(_collect_tool_results())
                            get_task = None

                            try:
                                while not tool_task.done():
                                    get_task = asyncio.create_task(sub_agent_queue.get())
                                    done, _ = await asyncio.wait(
                                        [tool_task, get_task],
                                        return_when=asyncio.FIRST_COMPLETED,
                                    )
                                    if get_task in done:
                                        envelope = get_task.result()
                                        yield AgentEvent(
                                            type=AgentEventType.SUB_AGENT,
                                            sub_agent=envelope,
                                        )
                                    else:
                                        get_task.cancel()

                                while not sub_agent_queue.empty():
                                    envelope = sub_agent_queue.get_nowait()
                                    yield AgentEvent(
                                        type=AgentEventType.SUB_AGENT,
                                        sub_agent=envelope,
                                    )

                                responses = await tool_task
                            finally:
                                tool_task.cancel()
                                await asyncio.gather(tool_task, return_exceptions=True)
                                if get_task is not None:
                                    get_task.cancel()
                                    await asyncio.gather(get_task, return_exceptions=True)
                            for response in responses:
                                self.logger.debug(
                                    f"{response.tool_call.function.name}("
                                    f"{response.tool_call.function.arguments})"
                                    f"=>'{re.sub(r'\s+', ' ', response.content[:64])}...'",  # noqa: E501
                                )
                                messages.append(LLMMessage.tool_call_result(response))
                                tool_results.append(response)

                        yield AgentEvent(
                            type=AgentEventType.COMPLETE,
                            content=event.content,
                            thinking=event.thinking,
                            tool_results=tool_results,
                            tool_calls=event.tool_calls or [],
                            input_tokens=event.input_tokens,
                            output_tokens=event.output_tokens,
                            total_tokens=event.total_tokens,
                            generation_duration_ms=event.generation_duration_ms,
                        )

                        if event.finish_reason == "stop":
                            return
