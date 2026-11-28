"""Tool dispatch for the agent loop: authorization, running tool calls, and direct image requests."""

from __future__ import annotations

import asyncio
import inspect
import uuid
from logging import Logger
from typing import AsyncGenerator, Awaitable, Callable, cast

import asterism.domains.settings.service as settings_service
from asterism.core.exceptions import BadDataException
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.execution_scope import (
    ChatScopeSnapshot,
    ExecutionScope,
    ProjectScopeSnapshot,
)
from asterism.domains.chat.schemas import Chat
from asterism.domains.llm.schemas import (
    ContentPart,
    LLMClientProtocol,
    LLMMessage,
    ToolCall,
    ToolResult,
)
from asterism.domains.retrieval.service import RetrievalService
from asterism.domains.tools.catalog import IMAGE_TOOL_NAME, INTERNAL_TOOL_NAMES, SCOPED_TOOL_NAMES
from asterism.domains.tools.context import ContextToolScope
from asterism.domains.tools.registry import tool_registry

from .approval import (
    ToolApprovalPolicy,
    ToolUseAuthorization,
)
from .delegation_scope import DelegationScope
from .schemas import (
    AgentEvent,
    AgentEventType,
    AgentProfile,
    SubAgentEventEnvelope,
    ToolProgress,
)


class ToolDispatch:
    """Authorizes and runs an agent's tool calls, streaming sub-agent and progress events.

    :class:`~asterism.domains.agent.agent.Agent` runs the loop and provides the
    state declared here; this class turns one step's tool calls into results.
    """

    user: AuthedUser
    session: Chat
    logger: Logger
    allowed_tools: list[str]
    effective_tools: list[str]
    _approval_policy: ToolApprovalPolicy
    authorization_check: Callable[[], Awaitable[None]]
    call_stack: list[uuid.UUID]
    delegation_execution_id: uuid.UUID | None
    delegation_scope: DelegationScope | None
    event_sink: Callable[[SubAgentEventEnvelope], Awaitable[None] | None] | None
    execution_scope: ExecutionScope | None
    parent_message_id: uuid.UUID | None
    retrieval_service: RetrievalService | None
    tool_scope: ContextToolScope | None
    user_files: list[str]
    profile: AgentProfile
    model_id: uuid.UUID | None
    chat_scope_snapshot: ChatScopeSnapshot | None
    project_scope_snapshot: ProjectScopeSnapshot | None

    async def _get_client(self) -> LLMClientProtocol:
        """The model client tool calls run with; the agent provides it."""
        raise NotImplementedError

    async def _run_tools(
        self,
        user_message: str,
        auths: list[ToolUseAuthorization],
        event_sink: Callable[[SubAgentEventEnvelope], Awaitable[None] | None] | None = None,
        progress_sink: Callable[[ToolProgress], Awaitable[None]] | None = None,
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

            # Scoped tools are capped by the inherited ceiling; load_skill is the agent's own.
            if self.execution_scope is None or (
                name in SCOPED_TOOL_NAMES and name not in self.execution_scope.effective_internal_tools
            ):
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
        app_settings = await settings_service.get_app_settings()
        accepted = [auth for auth in auths if auth.accept]
        # One model lookup for the whole batch of parallel calls, not one per call.
        client = await self._get_client() if accepted else None
        tasks = (
            []
            if client is None
            else [
                tool_registry.invoke_tool(
                    tool_call=auth.tool,
                    user=self.user,
                    session=self.session,
                    client=client,
                    app_settings=app_settings,
                    user_message=user_message or "",
                    user_files=self.user_files,
                    call_stack=self.call_stack,
                    caller_execution_id=self.delegation_execution_id,
                    event_sink=event_sink,
                    parent_message_id=self.parent_message_id,
                    delegation_scope=self.delegation_scope,
                    tool_scope=self.tool_scope,
                    execution_scope=self.execution_scope,
                    authorize_internal=authorize_internal,
                    retrieval_service=retrieval,
                    file_reader=create_runtime_file_reader(
                        ceiling=self.tool_scope, check_active=self.authorization_check
                    ),
                    progress_sink=progress_sink,
                )
                for auth in accepted
            ]
        )
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
                if name not in SCOPED_TOOL_NAMES or name in self.execution_scope.effective_internal_tools
            ]
        self.delegation_scope = self.tool_scope.delegation if self.tool_scope else None
        return self.effective_tools

    async def _step_tools(
        self,
        tool_calls: list[ToolCall],
        last_user_message: LLMMessage,
        results: list[ToolResult],
    ) -> AsyncGenerator[AgentEvent, None]:
        """Authorize and run one step's tool calls, streaming sub-agent events.

        Results are appended to ``results`` in completion order once every
        call has finished.
        """
        yield AgentEvent(type=AgentEventType.TOOL_CALL, tool_calls=tool_calls)

        auths = await self._approval_policy.authorize(
            tool_calls,
            sorted(set(self.allowed_tools) | (set(self.effective_tools) & INTERNAL_TOOL_NAMES)),
        )

        sub_agent_queue: asyncio.Queue[SubAgentEventEnvelope | ToolProgress] = asyncio.Queue()

        async def _internal_sink(envelope: SubAgentEventEnvelope) -> None:
            await sub_agent_queue.put(envelope)
            if self.event_sink:
                res = self.event_sink(envelope)
                if inspect.isawaitable(res):
                    await res

        async def _progress_sink(progress: ToolProgress) -> None:
            await sub_agent_queue.put(progress)

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
                progress_sink=_progress_sink,
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
                    yield self._queued_event(get_task.result())
                else:
                    get_task.cancel()

            while not sub_agent_queue.empty():
                yield self._queued_event(sub_agent_queue.get_nowait())

            responses = await tool_task
        finally:
            tool_task.cancel()
            await asyncio.gather(tool_task, return_exceptions=True)
            if get_task is not None:
                get_task.cancel()
                await asyncio.gather(get_task, return_exceptions=True)
        for response in responses:
            self.logger.debug("tool completed name=%s", response.tool_call.function.name)
            results.append(response)

    async def _direct_image(
        self, last_user_message: LLMMessage, *, tools_supported: bool
    ) -> AsyncGenerator[AgentEvent, None]:
        """ "Create image" without the tool: the message text is the prompt (ADR-0064).

        Used when the chat model has no tool support. If the model has tools but
        generate_image isn't offered, image generation was turned off since the
        message was sent.
        """
        from asterism.domains.image_generation.schemas import ImageProgress, ImageRequest
        from asterism.domains.image_generation.service import generate_images

        yield AgentEvent(type=AgentEventType.START)
        prompt = _message_text(last_user_message).strip()
        if tools_supported or self.execution_scope is None or not prompt:
            yield AgentEvent(type=AgentEventType.ERROR, content="Image generation is unavailable for this message")
            return
        queue: asyncio.Queue[ToolProgress] = asyncio.Queue()

        async def progress(update: ImageProgress) -> None:
            await queue.put(ToolProgress(tool_call_id="direct", name=IMAGE_TOOL_NAME, **update.model_dump()))

        task = asyncio.create_task(
            generate_images(
                user_id=self.user.id,
                chat_id=self.session.info.id,
                request=ImageRequest(prompt=prompt[:4000]),
                progress=progress,
                scope=self.execution_scope,
            )
        )
        try:
            while not task.done():
                getter = asyncio.create_task(queue.get())
                done, _ = await asyncio.wait([task, getter], return_when=asyncio.FIRST_COMPLETED)
                if getter in done:
                    yield self._queued_event(getter.result())
                else:
                    getter.cancel()
            while not queue.empty():
                yield self._queued_event(queue.get_nowait())
            images = task.result()
        except BadDataException as error:
            yield AgentEvent(type=AgentEventType.ERROR, content=str(error))
            return
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        embeds = "\n\n".join(image.embed for image in images)
        yield AgentEvent(type=AgentEventType.COMPLETE, content=f"Here's the image you asked for.\n\n{embeds}")

    @staticmethod
    def _queued_event(item: SubAgentEventEnvelope | ToolProgress) -> AgentEvent:
        if isinstance(item, ToolProgress):
            return AgentEvent(type=AgentEventType.TOOL_PROGRESS, tool_progress=item)
        return AgentEvent(type=AgentEventType.SUB_AGENT, sub_agent=item)


def _message_text(message: LLMMessage) -> str:
    if isinstance(message.content, str):
        return message.content
    # The typed prompt is the first text part; attachments follow it.
    return next((part.text for part in cast(list[ContentPart], message.content) if part.type == "text"), "")
