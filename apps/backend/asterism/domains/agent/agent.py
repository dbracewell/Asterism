from __future__ import annotations

import asyncio
import inspect
import uuid
from dataclasses import replace
from logging import Logger
from typing import AsyncGenerator, Awaitable, Callable, cast

import asterism.domains.settings.service as settings_service
from asterism.common.log import get_logger
from asterism.core.config import config
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.execution_scope import (
    ChatScopeSnapshot,
    ExecutionScope,
    ModelIdentity,
    ProjectScopeSnapshot,
    resolve_execution_scope,
)
from asterism.domains.chat.schemas import Chat, MessageExecution
from asterism.domains.llm.client import LLMClient
from asterism.domains.llm.schemas import (
    ContentPart,
    LLMClientProtocol,
    LLMEventType,
    LLMMessage,
    ToolResult,
)
from asterism.domains.retrieval.service import RetrievalService
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
from .prompts import PromptComposer, PromptSnapshot
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
        execution_scope: ExecutionScope | None = None,
        prompt_snapshot: PromptSnapshot | None = None,
        retrieval_service: RetrievalService | None = None,
    ) -> None:
        if profile.sub_agent and model_id is not None and model_id != profile.model_id:
            raise BadDataException("Sub-agent model binding cannot be overridden")
        self.tool_scope = tool_scope
        self.effective_tools: list[str] = []
        self._delegation_available = False
        self.delegation_scope = delegation_scope
        self.authorization_check = authorization_check
        self.execution_scope = execution_scope
        self.file_input_authorization: Callable[[], Awaitable[None]] | None = None
        self.retrieval_service = retrieval_service
        self.prompt_snapshot = prompt_snapshot
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
        self.chat_scope_snapshot: ChatScopeSnapshot | None = None
        self.project_scope_snapshot: ProjectScopeSnapshot | None = None
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

    async def prepare_execution(
        self,
        message_id: uuid.UUID,
        *,
        restart: bool = False,
        chat_snapshot: ChatScopeSnapshot | None = None,
        project_snapshot: ProjectScopeSnapshot | None = None,
    ) -> MessageExecution:
        from asterism.domains.chat.execution import prepare_execution, read_execution_prompt

        if self.profile.sub_agent:
            raise BadDataException("Sub-agents retain their fixed model binding")
        if chat_snapshot is None:
            from asterism.db.database import get_async_db_session
            from asterism.domains.chat.scope import read_chat_scope_snapshot, read_project_scope_snapshot

            async with get_async_db_session() as session:
                chat_snapshot = await read_chat_scope_snapshot(
                    user_id=self.user.id, chat_id=self.session.info.id, session=session
                )
                project_snapshot = (
                    await read_project_scope_snapshot(
                        user_id=self.user.id, project_id=chat_snapshot.project_id, session=session
                    )
                    if chat_snapshot.project_id
                    else None
                )
        self.chat_scope_snapshot = chat_snapshot
        self.project_scope_snapshot = project_snapshot
        execution = await prepare_execution(
            user_id=self.user.id,
            chat_id=self.session.info.id,
            message_id=message_id,
            restart=restart,
            chat_snapshot=self.chat_scope_snapshot,
            project_snapshot=self.project_scope_snapshot,
        )
        self.apply_execution(execution)
        self.prompt_snapshot = await read_execution_prompt(
            user_id=self.user.id,
            chat_id=self.session.info.id,
            message_id=message_id,
        )
        return execution

    def apply_execution(self, execution: MessageExecution) -> None:
        self._client = None
        self.execution = execution
        self.prompt_snapshot = None
        self.execution_scope = None
        self.tool_scope = None
        self.delegation_scope = None
        self.model_id = execution.model.id
        self.profile = AgentProfile.model_validate(
            {**execution.configuration.model_dump(exclude_none=True), "sub_agent": False, "model_id": None},
        )
        self.max_steps = self.profile.max_steps

    async def prepare_execution_scope(
        self,
        *,
        chat_snapshot: ChatScopeSnapshot | None = None,
        project_snapshot: ProjectScopeSnapshot | None = None,
    ) -> ExecutionScope:
        from asterism.db.database import get_async_db_session
        from asterism.domains.chat.scope import read_chat_scope_snapshot, read_project_scope_snapshot

        async with get_async_db_session() as db:
            chat_snap = chat_snapshot or await read_chat_scope_snapshot(
                user_id=self.user.id, chat_id=self.session.info.id, session=db
            )
            project_snap = (
                project_snapshot
                if project_snapshot is not None
                else (
                    await read_project_scope_snapshot(
                        user_id=self.user.id, project_id=chat_snap.project_id, session=db
                    )
                    if chat_snap.project_id
                    else None
                )
            )
            self.chat_scope_snapshot = chat_snap
            self.project_scope_snapshot = project_snap

            await self.resolve_tools(reset=not self.profile.sub_agent)
            executed_model = None
            if self.model_id is not None:
                if self.execution is not None:
                    choice = self.execution.model
                    executed_model = ModelIdentity(id=choice.id, provider_id=choice.provider_id, name=choice.name)
                elif self.execution_scope is not None and self.execution_scope.executed_model is not None:
                    executed_model = self.execution_scope.executed_model
                else:
                    executed_model = ModelIdentity(id=self.model_id)
            selected_choice = self.session.info.selected_model
            selected_model = (
                ModelIdentity(
                    id=selected_choice.id,
                    provider_id=selected_choice.provider_id,
                    name=selected_choice.name,
                )
                if selected_choice is not None
                else None
            )
            if self.execution is not None:
                choice = self.execution.model
                selected_model = ModelIdentity(id=choice.id, provider_id=choice.provider_id, name=choice.name)
            if self.profile.sub_agent and self.execution_scope is not None:
                selected_model = self.execution_scope.selected_model

            async def chat_reader():
                return chat_snap

            async def project_reader(project_id: uuid.UUID):
                if project_snap is not None and project_snap.project_id == project_id:
                    return project_snap
                return await read_project_scope_snapshot(user_id=self.user.id, project_id=project_id, session=db)

            scope = await resolve_execution_scope(
                user_id=self.user.id,
                user_profile_id=None,
                agent_id=self.profile.id,
                is_sub_agent=self.profile.sub_agent,
                chat_id=self.session.info.id,
                selected_model=selected_model,
                executed_model=executed_model,
                effective_internal_tools=frozenset(set(self.effective_tools) & INTERNAL_TOOL_NAMES),
                configuration_revision=self.profile.config_revision,
                chat_scope_reader=chat_reader,
                project_scope_reader=project_reader,
            )
        if self.profile.sub_agent and self.execution_scope is not None:
            if (
                scope.project_id != self.execution_scope.project_id
                or not scope.allowed_file_ids <= self.execution_scope.allowed_file_ids
                or not scope.eligible_sub_agent_ids <= self.execution_scope.eligible_sub_agent_ids
                or not scope.effective_internal_tools <= self.execution_scope.effective_internal_tools
            ):
                raise BadDataException("Delegated execution scope changed")
        if self.profile.sub_agent and self.execution_scope is not None:
            scope = replace(
                scope,
                configuration_provenance=self.execution_scope.configuration_provenance,
                selected_sub_agent_ids=self.execution_scope.selected_sub_agent_ids,
                execution_id=self.execution_scope.execution_id,
                request_message_id=self.execution_scope.request_message_id,
            )
        if self.execution is not None and self.execution.context is not None:
            recorded = self.execution.context
            if (
                recorded.user_id != scope.user_id
                or recorded.chat_id != scope.chat_id
                or recorded.project_id != scope.project_id
            ):
                raise BadDataException("Recorded source context changed; regenerate")
            allowed = scope.allowed_file_ids & frozenset(recorded.allowed_file_ids)
            scope = replace(
                scope,
                allowed_file_ids=allowed,
                file_provenance=tuple(file for file in scope.file_provenance if file.file_id in allowed),
                eligible_sub_agent_ids=scope.eligible_sub_agent_ids & frozenset(recorded.selected_sub_agent_ids),
                selected_sub_agent_ids=frozenset(recorded.selected_sub_agent_ids),
                configuration_provenance=recorded.configurations,
            )
        if self.prompt_snapshot is not None:
            if scope.project_id != self.prompt_snapshot.project_id:
                raise BadDataException("Recorded prompt project changed; regenerate")
            scope = replace(
                scope,
                prompt_revision=self.prompt_snapshot.project_revision,
                project_instructions=self.prompt_snapshot.project_instructions,
            )
        if self.execution is not None:
            scope = replace(scope, request_message_id=self.execution.request_message_id, execution_id=self.execution.id)
        self.execution_scope = scope
        return scope

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
        if self.execution_scope is not None:
            self.execution_scope = replace(
                self.execution_scope,
                executed_model=ModelIdentity(
                    id=self.model_id, provider_id=model_info.provider.id, name=model_info.name
                ),
            )
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

            if self.execution_scope is None or name not in self.execution_scope.effective_internal_tools:
                raise BadDataException("Internal tool is unavailable in this execution context")
            await require_internal_tool(
                name=name, user_id=self.user.id, chat_id=self.session.info.id, scope=self.tool_scope
            )

        from asterism.domains.chat.retrieval import create_retrieval_service
        from asterism.domains.chat.runtime_files import create_runtime_file_reader

        retrieval = self.retrieval_service or create_retrieval_service(
            ceiling=self.tool_scope,
            check_active=self.authorization_check,
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
                execution_scope=self.execution_scope,
                authorize_internal=authorize_internal,
                retrieval_service=retrieval,
                file_reader=create_runtime_file_reader(ceiling=self.tool_scope, check_active=self.authorization_check),
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
            chat_snapshot=self.chat_scope_snapshot,
            project_snapshot=self.project_scope_snapshot,
        )
        if self.execution_scope is not None:
            self.effective_tools = [
                name
                for name in self.effective_tools
                if name not in INTERNAL_TOOL_NAMES or name in self.execution_scope.effective_internal_tools
            ]
        self.delegation_scope = self.tool_scope.delegation if self.tool_scope else None
        return self.effective_tools

    async def _build_system_prompt(self) -> str:
        from asterism.domains.chat.prompt_composition import build_prompt_snapshot, build_runtime_prompt

        await self.resolve_tools(reset=not self.profile.sub_agent)
        self._delegation_available = "sub_agent" in self.effective_tools
        snapshot = self.prompt_snapshot
        if snapshot is None and self.execution is not None:
            from asterism.domains.chat.execution import read_execution_prompt

            snapshot = await read_execution_prompt(
                user_id=self.user.id,
                chat_id=self.session.info.id,
                message_id=self.execution.request_message_id,
            )
            if snapshot.provenance != self.execution.prompt:
                raise BadDataException("Recorded prompt changed; regenerate")
            self.prompt_snapshot = snapshot
        if snapshot is None and self.execution_scope is not None and self.profile.sub_agent:
            scope = self.execution_scope
            snapshot = PromptComposer().snapshot(
                agent_id=self.profile.id,
                agent_revision=self.profile.config_revision,
                agent_instructions=self.profile.system_prompt or "",
                project_id=scope.project_id,
                project_revision=scope.prompt_revision,
                project_instructions=scope.project_instructions,
                runtime_context=await build_runtime_prompt(
                    user_id=self.user.id,
                    chat_id=self.session.info.id,
                    profile=self.profile,
                    tools=self.effective_tools,
                    scope=self.tool_scope,
                ),
            )
            self.prompt_snapshot = snapshot
        if snapshot is None:
            snapshot = await build_prompt_snapshot(
                user_id=self.user.id,
                chat_id=self.session.info.id,
                profile=self.profile,
                model_id=self.model_id,
                ceiling=self.tool_scope,
                chat_snapshot=self.chat_scope_snapshot,
                project_snapshot=self.project_scope_snapshot,
            )
        return snapshot.text

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

            if self.file_input_authorization:
                await self.file_input_authorization()
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
                        self.logger.debug("event type=%s tool_count=%d", event.type, len(event.tool_calls or []))

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
                                self.logger.debug("tool completed name=%s", response.tool_call.function.name)
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

                        # A turn without tool calls is final. Do not rely on the
                        # provider's finish_reason: local servers often send None,
                        # and "length"/"content_filter" must not re-prompt the model.
                        if not event.tool_calls:
                            return
