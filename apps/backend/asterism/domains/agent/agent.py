from __future__ import annotations

import uuid
from dataclasses import replace
from logging import Logger
from typing import AsyncGenerator, Awaitable, Callable

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
from asterism.domains.llm.factory import create_llm_client
from asterism.domains.llm.metering import meter_for
from asterism.domains.llm.schemas import (
    LLMClientProtocol,
    LLMEventType,
    LLMMessage,
    ToolResult,
    unique_tool_call_ids,
)
from asterism.domains.retrieval.service import RetrievalService
from asterism.domains.settings.schemas import LlmWithProvider
from asterism.domains.tools.catalog import IMAGE_TOOL_NAME, SCOPED_TOOL_NAMES, configurable_tools
from asterism.domains.tools.context import ContextToolScope
from asterism.domains.usage.schemas import UsageSource

from .approval import (
    AllowlistApprovalPolicy,
    ToolApprovalPolicy,
)
from .delegation_scope import DelegationScope
from .instruction_overrides import InstructionOverride, ReplayedStep
from .prompts import PromptComposer, PromptSnapshot
from .schemas import (
    AgentEvent,
    AgentEventType,
    AgentProfile,
    SubAgentEventEnvelope,
)
from .skill_inputs import SkillCatalogEntry
from .tool_dispatch import ToolDispatch


class Agent(ToolDispatch):
    def __init__(
        self,
        profile: AgentProfile,
        user: AuthedUser,
        session: Chat,
        logger: Logger | None = None,
        allowed_tools: list[str] | None = None,
        approval_policy: ToolApprovalPolicy | None = None,
        call_stack: list[uuid.UUID] | None = None,
        delegation_execution_id: uuid.UUID | None = None,
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
        self._external_authorization_check = authorization_check
        self.authorization_check = self._check_authorization
        self.execution_scope = execution_scope
        self.file_input_authorization: Callable[[], Awaitable[None]] | None = None
        self.retrieval_service = retrieval_service
        self.prompt_snapshot = prompt_snapshot
        self.execution: MessageExecution | None = None
        # A fork's run-only sub-agent instructions, read with its execution.
        self.instruction_overrides: tuple[InstructionOverride, ...] = ()
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
        # The skills a sub-agent could load this run, read with its prompt (ADR-0062).
        self.skill_catalog: tuple[SkillCatalogEntry, ...] = ()
        # The turn was sent with "Create image": its first step must generate (ADR-0064).
        self.image_request = False
        self.chat_scope_snapshot: ChatScopeSnapshot | None = None
        self.project_scope_snapshot: ProjectScopeSnapshot | None = None
        # Set when this agent runs as a delegated sub-agent; tags its own delegations.
        self.delegation_execution_id = delegation_execution_id
        if call_stack is not None:
            self.call_stack: list[uuid.UUID] = list(call_stack)
        elif self.profile.id is not None:
            self.call_stack = [self.profile.id]
        else:
            self.call_stack = []

    async def _check_authorization(self) -> None:
        if self._external_authorization_check:
            await self._external_authorization_check()
        if self.execution is not None and self.execution.skills and not self.profile.sub_agent:
            from asterism.domains.chat.skills import validate_execution_skills

            await validate_execution_skills(user_id=self.user.id, execution=self.execution)

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
        from asterism.domains.chat.execution import (
            prepare_execution,
            read_execution_overrides,
            read_execution_prompt,
        )

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
        self.instruction_overrides = await read_execution_overrides(
            user_id=self.user.id,
            chat_id=self.session.info.id,
            message_id=message_id,
            execution=execution,
        )
        return execution

    def apply_execution(self, execution: MessageExecution) -> None:
        self._client = None
        self.execution = execution
        self.prompt_snapshot = None
        self.instruction_overrides = ()
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
                    await read_project_scope_snapshot(user_id=self.user.id, project_id=chat_snap.project_id, session=db)
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
                agent_id=self.profile.id,
                is_sub_agent=self.profile.sub_agent,
                chat_id=self.session.info.id,
                selected_model=selected_model,
                executed_model=executed_model,
                effective_internal_tools=frozenset(set(self.effective_tools) & SCOPED_TOOL_NAMES),
                configuration_revision=self.profile.config_revision,
                chat_scope_reader=chat_reader,
                project_scope_reader=project_reader,
            )
        if self.execution is not None:
            layer = (
                next((layer for layer in self.prompt_snapshot.layers if layer.kind == "profile"), None)
                if self.prompt_snapshot
                else None
            )
            from asterism.domains.chat.memories import read_execution_memory_layer

            scope = replace(
                scope,
                about_revision=self.execution.about.revision,
                about_layer=layer,
                # Built from the turn's pinned memories, minus any deleted since (ADR-0078).
                memory_layer=await read_execution_memory_layer(
                    user_id=self.user.id, chat_id=self.session.info.id, execution=self.execution
                ),
            )
        elif self.profile.sub_agent and self.execution_scope is not None:
            # Child agents inherit the recorded About you and memory layers.
            scope = replace(
                scope,
                about_revision=self.execution_scope.about_revision,
                about_layer=self.execution_scope.about_layer,
                memory_layer=self.execution_scope.memory_layer,
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
                instruction_overrides=self.execution_scope.instruction_overrides,
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
            scope = replace(
                scope,
                request_message_id=self.execution.request_message_id,
                execution_id=self.execution.id,
                instruction_overrides=self.instruction_overrides,
            )
        self.execution_scope = scope
        return scope

    async def _get_client(self) -> LLMClientProtocol:
        if self.model_id is None:
            raise BadDataException("Choose an available chat model before generating")
        try:
            model_info: LlmWithProvider = await settings_service.get_model_and_provider(
                model_id=self.model_id, user_id=self.user.id
            )
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
                    id=self.model_id,
                    provider_id=model_info.provider.id,
                    name=model_info.name,
                    provider_type=model_info.provider.provider_type,
                    pricing=model_info.pricing,
                    supports_tools=model_info.supports_tools,
                ),
            )
        if self._client is not None:
            return self._client

        source = UsageSource.DELEGATION if self.profile.sub_agent else UsageSource.CHAT
        client = create_llm_client(
            model_info.name,
            model_info.provider,
            user_id=self.user.id,
            usage=meter_for(self.user.id, source, model_info, chat_id=self.session.info.id),
        )
        self._client = client
        return client

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
            from asterism.domains.chat.prompt_composition import read_skill_catalog_layer

            scope = self.execution_scope
            self.skill_catalog, catalog_layer = await read_skill_catalog_layer(
                user_id=self.user.id, profile=self.profile, tools=self.effective_tools
            )
            snapshot = PromptComposer().snapshot(
                skill_catalog_layer=catalog_layer,
                profile_layer=scope.about_layer,
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
        # The memory layer joins the prompt for this run only; it is never recorded.
        if self.execution_scope is not None:
            layer = self.execution_scope.memory_layer
        elif self.execution is not None:
            from asterism.domains.chat.memories import read_execution_memory_layer

            layer = await read_execution_memory_layer(
                user_id=self.user.id, chat_id=self.session.info.id, execution=self.execution
            )
        else:
            layer = None
        return snapshot.with_memory(layer).text

    async def _replay_step(
        self,
        replay: ReplayedStep,
        messages: list[LLMMessage],
        last_user_message: LLMMessage,
    ) -> AsyncGenerator[AgentEvent, None]:
        """Run a fork's recorded step without calling the model (ADR-0038).

        The recorded text and tool calls are kept. Recorded results are reused,
        and only the remaining calls run again. Results keep the step's call order.
        """
        yield AgentEvent(type=AgentEventType.START)
        messages.append(LLMMessage.assistant(content=replay.content, tool_calls=replay.tool_calls))
        fresh_calls = [call for call in replay.tool_calls if call.id not in replay.reused_results]
        fresh: list[ToolResult] = []
        if fresh_calls:
            async for event in self._step_tools(fresh_calls, last_user_message, fresh):
                yield event
        by_id = {**replay.reused_results, **{result.tool_call.id: result for result in fresh}}
        tool_results = [by_id[call.id] for call in replay.tool_calls if call.id in by_id]
        for result in tool_results:
            messages.append(LLMMessage.tool_call_result(result))
        yield AgentEvent(
            type=AgentEventType.COMPLETE,
            content=replay.content,
            thinking=replay.thinking,
            tool_results=tool_results,
            tool_calls=replay.tool_calls,
        )

    async def run(
        self,
        messages: list[LLMMessage],
        *,
        replay: ReplayedStep | None = None,
    ) -> AsyncGenerator[AgentEvent, None]:
        """Run the bounded agent loop.

        With ``replay``, the loop starts from that recorded step instead of
        calling the model, then continues with the steps left in its budget.
        """
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
        first_step = 0
        if replay is not None:
            if self.authorization_check:
                await self.authorization_check()
            async for event in self._replay_step(replay, messages, last_user_message):
                yield event
            # The recorded step called tools, so at least a final answer step remains.
            first_step = min(replay.step_index + 1, self.max_steps - 1)
        for step in range(first_step, self.max_steps):
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
            parameters = dict(self.profile.chat_parameters)
            if self.image_request and step == first_step and replay is None:
                if tools and IMAGE_TOOL_NAME in tools:
                    parameters["tool_choice"] = {"type": "function", "function": {"name": IMAGE_TOOL_NAME}}
                else:
                    async for event in self._direct_image(last_user_message, tools_supported=bool(tools)):
                        yield event
                    return
            async for event in client.chat(
                messages=messages,
                tools=tools,
                **parameters,
            ):
                # Access is checked at each step's start, when the stream
                # starts and before a completed step is recorded or runs tools;
                # never per delta, since each check reads the database (US-77.1).
                match event.type:
                    case LLMEventType.ERROR:
                        yield AgentEvent(
                            type=AgentEventType.ERROR,
                            content=str(event.exception),
                            error_code=getattr(event.exception, "code", None),
                        )
                        return
                    case LLMEventType.START:
                        if self.authorization_check:
                            await self.authorization_check()
                        yield AgentEvent(type=AgentEventType.START)
                    case LLMEventType.TEXT_DELTA | LLMEventType.THINKING_DELTA:
                        yield AgentEvent(
                            type=AgentEventType.DELTA,
                            content=event.content,
                            thinking=event.thinking,
                        )
                    case LLMEventType.COMPLETE:
                        if self.authorization_check:
                            await self.authorization_check()
                        # Unique before approval: decisions and results match by id.
                        step_calls = unique_tool_call_ids(event.tool_calls or [])
                        messages.append(
                            LLMMessage.assistant(
                                content=event.content,
                                tool_calls=step_calls,
                            ),
                        )
                        self.logger.debug("event type=%s tool_count=%d", event.type, len(step_calls))

                        tool_results: list[ToolResult] = []
                        # A step that offered no tools (the final one) never runs a call (US-113.2).
                        if step_calls and tools:
                            async for tool_event in self._step_tools(step_calls, last_user_message, tool_results):
                                yield tool_event
                            for response in tool_results:
                                messages.append(LLMMessage.tool_call_result(response))

                        yield AgentEvent(
                            type=AgentEventType.COMPLETE,
                            content=event.content,
                            thinking=event.thinking,
                            tool_results=tool_results,
                            tool_calls=step_calls,
                            input_tokens=event.input_tokens,
                            output_tokens=event.output_tokens,
                            total_tokens=event.total_tokens,
                            generation_duration_ms=event.generation_duration_ms,
                        )

                        # A turn without tool calls is final. Do not rely on the
                        # provider's finish_reason: local servers often send None,
                        # and "length"/"content_filter" must not re-prompt the model.
                        if not step_calls:
                            return
