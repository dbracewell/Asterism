from __future__ import annotations

import asyncio
import json
import uuid
from logging import Logger
from typing import TYPE_CHECKING

import asterism.domains.chat.service as chat_service
from asterism.common.collection_utils import index_of
from asterism.common.log import get_logger
from asterism.core.events import ChatUpdateEvent, Event, EventType, event_bus
from asterism.core.exceptions import BadDataException
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.approval import InteractiveApprovalPolicy
from asterism.domains.agent.context_manifest import ContextFile, ContextManifest
from asterism.domains.agent.schemas import AgentEvent, AgentEventType
from asterism.domains.chat.context_manifest import file_context, step_context, turn_context
from asterism.domains.chat.delegations import DelegationCollector
from asterism.domains.chat.exercises import HISTORY_NOTE, is_exercise_run, streamed_text
from asterism.domains.chat.forks import replayed_step, write_fork_step
from asterism.domains.chat.message_queue import MessageQueue, get_message_queue
from asterism.domains.chat.prompts import create_title_generation_prompt
from asterism.domains.chat.schemas import (
    Chat,
    ChatContextUsage,
    ChatUpdateRequest,
    Message,
    MessageExecution,
    MessageStatus,
    NewMessageRequest,
    UpdateMessageRequest,
)
from asterism.domains.chat.title_model import resolve_title_model
from asterism.domains.files.produced import file_reference_token
from asterism.domains.llm.schemas import (
    ImageUrlContent,
    ImageUrlContentPart,
    LLMMessage,
    TextContentPart,
    ToolCall,
    ToolResult,
)
from asterism.domains.llm.token_counting import estimate_text_tokens
from asterism.domains.projects.goals import render_goal
from asterism.domains.prompt_templates.provenance import TemplateProvenance
from asterism.domains.prompt_templates.rubrics import render_rubric
from asterism.domains.settings import service as settings_service
from asterism.domains.tools.registry import tool_registry

if TYPE_CHECKING:
    from asterism.domains.agent.user_response_queue import UserResponseQueue


class ChatOrchestrator:
    """Manages the state of a single chat session, including the agent, message queue, and WebSocket connection."""

    def __init__(
        self,
        agent: Agent,
    ):
        self.chat: Chat = agent.session
        self.agent: Agent = agent
        self.logger: Logger = get_logger("ChatSession")
        self.is_processing_messages: bool = False
        self.pending_approvals: dict[str, asyncio.Future] = {}
        self._active_parent_id: uuid.UUID | None = None
        self._streaming_content: str = ""
        self._streaming_thinking: str = ""
        self._execution: MessageExecution | None = None
        self._delegations = DelegationCollector()
        # US-54.3: what the current run was given, shared by its steps.
        self._context: ContextManifest | None = None
        # US-54.4: identifies the comparison column the current run answers.
        self._comparison: dict[str, str] | None = None
        # US-54.5: the pending fork step being replayed, until it is recorded.
        self._fork_step: Message | None = None

        # Inject interactive approval into the agent so tool
        # authorization flows through the WebSocket UI.
        self.agent._approval_policy = InteractiveApprovalPolicy(
            on_pending=self._handle_tool_approval,
        )

    @property
    def queue(self) -> MessageQueue:
        return get_message_queue(self.chat.info.id)

    @property
    def chat_id(self) -> uuid.UUID:
        return self.chat.info.id

    @property
    def user_id(self) -> str:
        return self.chat.info.user_id

    @property
    def is_active(self) -> bool:
        return self.queue.qsize() > 0 or self.is_processing_messages

    async def _emit(self, packet: dict) -> None:
        """Queue a client packet; comparison runs are tagged with their column."""
        if self._comparison is not None:
            packet = {**packet, "comparison": self._comparison}
        await self.queue.put(packet)

    def _column_of_current_turn(self) -> dict[str, str] | None:
        column = next((message for message in reversed(self.chat.messages) if message.role == "user"), None)
        if column is None or column.comparison_id is None:
            return None
        return {"id": str(column.comparison_id), "column_id": str(column.id)}

    async def reload_chat(self) -> None:
        self.chat = await chat_service.get_one(chat_id=self.chat_id, user_id=self.user_id)
        self.agent.session = self.chat
        if self.chat.info.agent_id is not None:
            await self.agent.refresh_main_configuration()

    async def resume_pending_turn(self) -> None:
        await self.reload_chat()
        columns = await chat_service.pending_comparison_columns(self.user_id, self.chat_id)
        if columns:
            await self.run_comparison(columns)
        else:
            await self.run_agent()

    async def run_comparison(self, column_ids: list[uuid.UUID]) -> None:
        """Answer comparison columns one after another inside this chat's single work slot.

        Each column runs on its own root-to-column history, so a column that is
        not on the active branch never sees another column's answer. A
        cancellation stops the current column and cancels the rest.
        """
        current = 0
        try:
            for current, column_id in enumerate(column_ids):
                self.chat.messages = await chat_service.read_column_branch(self.user_id, self.chat_id, column_id)
                self.agent.session = self.chat
                await self.run_agent()
        except asyncio.CancelledError:
            # Includes the current column when it was cancelled before generating;
            # only still-pending columns change.
            await chat_service.cancel_comparison_columns(self.user_id, self.chat_id, column_ids[current:])
            raise
        finally:
            await self.reload_chat()

    async def cancel_active_generation(self) -> None:
        """Finalize the active user turn so reconnecting never re-runs it."""
        parent_id = self._active_parent_id
        if parent_id is None:
            return

        if self._fork_step is not None:
            await self._cancel_fork_step()
            self._active_parent_id = None
            return

        parent_index = index_of(self.chat.messages, lambda message: message.id == parent_id)

        # Retain useful streamed output and delegation work rather than
        # silently discarding it.
        delegations = self._delegations.drain(unfinished="cancelled")
        if self._streaming_content or self._streaming_thinking or delegations:
            partial = await chat_service.add_message(
                user_id=self.user_id,
                chat_id=self.chat_id,
                message=NewMessageRequest(
                    role="assistant",
                    content=self._streaming_content,
                    thinking=self._streaming_thinking,
                    status=MessageStatus.CANCELLED,
                    delegations=delegations or None,
                    context=self._context,
                    parent_message_id=parent_id,
                    execution=self._execution,
                    model_id=self.agent.model_id,  # type: ignore
                ),
            )
            self.chat.messages.append(partial)

        # add_message marks its parent complete when it attaches a child, so
        # write the terminal user-visible cancellation state last.
        parent = await chat_service.write_message_update(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message_id=parent_id,
            payload=UpdateMessageRequest(status=MessageStatus.CANCELLED),
        )
        if parent_index >= 0:
            self.chat.messages[parent_index] = parent

        await self._emit(
            {
                "type": AgentEventType.COMPLETE.value,
                "last_messages": [message.model_dump(mode="json") for message in self.chat.messages[parent_index:]],
            },
        )
        self._active_parent_id = None

    async def _cancel_fork_step(self) -> None:
        """Record a cancelled fork step with the work it finished (ADR-0038).

        Calls that did not finish get a cancelled result so the branch stays a
        valid conversation if the user continues from it.
        """
        step = self._fork_step
        assert step is not None
        self._fork_step = None
        recorded = {result.tool_call.id: result for result in step.tool_call_results or [] if result}
        results = [
            recorded.get(call.id)
            or ToolResult(content="Cancelled before it finished.", raw_result=None, is_empty=True, tool_call=call)
            for call in step.tool_calls or []
        ]
        cancelled = await write_fork_step(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message_id=step.id,
            status=MessageStatus.CANCELLED,
            tool_call_results=results or None,
            delegations=[*(step.delegations or []), *self._delegations.drain(unfinished="cancelled")] or None,
            context=self._context,
        )
        self.chat.messages.append(cancelled)
        await self._emit(
            {
                "type": AgentEventType.COMPLETE.value,
                "last_messages": [cancelled.model_dump(mode="json")],
            },
        )

    async def _complete_fork_step(self, event: AgentEvent) -> Message:
        """Record the replayed fork step: reused work plus what ran again."""
        step = self._fork_step
        assert step is not None
        self._fork_step = None
        return await write_fork_step(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message_id=step.id,
            status=MessageStatus.COMPLETED,
            tool_call_results=event.tool_results or None,
            delegations=[*(step.delegations or []), *self._delegations.drain()] or None,
            context=step_context(self._context, event.tool_results) if self._context else None,
        )

    def find_message(self, message_id: str) -> tuple[int, Message]:
        message_index: int = index_of(
            self.chat.messages,
            lambda m: str(m.id) == message_id,
        )
        if message_index < 0:
            raise BadDataException(f"Message not for id {message_id}")
        return message_index, self.chat.messages[message_index]

    async def handle_regenerate_message(self, parent_message_index: int) -> None:
        self._execution = await self.agent.prepare_execution(self.chat.messages[parent_message_index].id, restart=True)
        parent_message: Message = self.chat.messages[parent_message_index]
        parent_message = await chat_service.write_message_update(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message_id=parent_message.id,
            payload=UpdateMessageRequest(
                active_child_id=None,
                status=MessageStatus.PENDING,
            ),
        )
        self.chat.messages = self.chat.messages[:parent_message_index]
        self.chat.messages.append(parent_message)
        await self.run_agent()

    async def _save_chat_title(self, title: str) -> None:
        self.chat.info.title = title
        updated = await chat_service.update_chat(
            user_id=self.user_id,
            chat_id=self.chat_id,
            payload=ChatUpdateRequest(title=title),
        )
        self.chat.info.project_id = updated.info.project_id
        event_bus.emit(
            Event(
                type=EventType.WEBHOOK_CHAT_UPDATE,
                payload=ChatUpdateEvent(session_id=self.chat_id, title=title, project_id=updated.info.project_id),
                user_id=self.user_id,
            ),
        )

    @staticmethod
    def _validated_title(candidate: str) -> str:
        title = " ".join(candidate.strip().strip('"').split())[:120]
        # Some providers return a serialized null instead of a title. Treat it
        # as invalid so the bounded retry sequence reaches the useful fallback.
        if title.casefold().strip(" .!?;:'\"") in {
            "",
            "n/a",
            "na",
            "no title",
            "none",
            "null",
            "undefined",
            "untitled",
        }:
            return ""
        return title

    async def generate_chat_title(self) -> None:
        if self.chat.info.title is not None and not self.chat.info.title.isspace():
            return

        user_message = next((m for m in self.chat.messages if m.role == "user" and m.content.strip()), None)
        if user_message is None:
            return

        title = ""
        title_model = None
        try:
            # The draft model, else the owner's own ChatGPT plan (title_model).
            title_model = await resolve_title_model(self.user_id, self.chat.info.selected_model_id)
        except Exception as error:
            # A missing/unavailable title model must use the same bounded
            # fallback as failed title-generation attempts.
            self.logger.warning("Chat title setup failed: %s", error)
        if title_model is not None:
            for _ in range(3):
                try:
                    async with asyncio.timeout(15):
                        candidate = await title_model.invoke(
                            messages=[
                                LLMMessage.user(create_title_generation_prompt(user_message.content.strip())),
                            ],
                        )
                    title = self._validated_title(candidate)
                    if title:
                        break
                except Exception as error:
                    self.logger.warning("Chat title attempt failed: %s", error)

        if not title:
            title = " ".join(str(user_message.content).split())[:80] or "New chat"
        await self._save_chat_title(title)

    async def _handle_tool_approval(
        self,
        pending_tools: list[ToolCall],
        queue: UserResponseQueue,
    ) -> None:
        """
        Callback for InteractiveApprovalPolicy. Emits WebSocket
        permission-request messages and waits for user decisions.
        """
        tasks = []
        for tool in pending_tools:
            await self._emit(
                {
                    "type": "tool_permission_request",
                    "id": tool.id,
                    "name": tool.function.name,
                    "arguments": tool.function.arguments,
                },
            )
            tasks.append(self._wait_for_ui_approval(tool, queue))

        await asyncio.gather(*tasks)

    async def _wait_for_ui_approval(
        self,
        tool: ToolCall,
        queue: UserResponseQueue,
    ) -> None:
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        try:
            async with asyncio.timeout(60):
                self.pending_approvals[tool.id] = future
                is_approved = await future
                queue.respond(tool, is_approved)
        except asyncio.TimeoutError:
            self.logger.info(f"Tool {tool.id} timed out waiting for user approval.")
            queue.respond(tool, False)
            await self._emit({"type": "tool_update", "id": tool.id})
        finally:
            self.pending_approvals.pop(tool.id, None)

    def resolve_tool_approval(self, tool_id: str, approved: bool) -> None:
        future = self.pending_approvals.get(tool_id)
        if future and not future.done():
            future.set_result(approved)

    async def _build_agent_messages(self) -> list[LLMMessage]:
        messages, _ = await self._assemble_agent_messages()
        return messages

    async def _assemble_agent_messages(self) -> tuple[list[LLMMessage], list[ContextFile]]:
        """The provider messages, plus how each attached file was included (US-54.3)."""
        ids = {file.file_id for message in self.chat.messages for file in message.files}
        payloads = {}
        self.agent.file_input_authorization = None
        if ids:
            from asterism.domains.chat.runtime_files import create_runtime_file_reader

            execution_scope = (
                await self.agent.prepare_execution_scope()
                if self.agent.execution is None
                else self.agent.execution_scope or await self.agent.prepare_execution_scope()
            )
            model = await settings_service.get_model_and_provider(
                model_id=self.agent.model_id, user_id=self.agent.user.id
            )
            reader = create_runtime_file_reader(
                ceiling=self.agent.tool_scope, check_active=self.agent.authorization_check
            )
            allowed = execution_scope.allowed_file_ids
            self.agent.user_files = [str(file_id) for file_id in sorted(allowed, key=str)]
            loaded: set[uuid.UUID] = set()
            for file_id in sorted(ids & allowed, key=str):
                payload = await reader.read_for_model(
                    execution_scope, file_id, supports_vision=model.supports_vision is True
                )
                payloads[file_id] = payload
                # An empty source is still an attached source: presence is what
                # matters, not whether the extracted text has content.
                if payload.text is not None or payload.image_url is not None:
                    loaded.add(file_id)
            input_ids = frozenset(loaded)

            async def authorize_payload():
                await reader.validate_files(execution_scope, input_ids)

            await authorize_payload()
            self.agent.file_input_authorization = authorize_payload

        messages: list[LLMMessage] = []
        for message in self.chat.messages:
            if message.role == "assistant" and message.exercise is not None:
                # Later turns, in any mode, must not rely on an exercise answer.
                messages.append(LLMMessage(**{**message.model_dump(), "content": message.content + HISTORY_NOTE}))
            elif message.role != "user" or not (message.files or message.rubric or message.goal):
                messages.append(LLMMessage(**message.model_dump()))
            else:
                parts: list[TextContentPart | ImageUrlContentPart] = [TextContentPart(text=message.content)]
                if message.goal is not None:
                    # The goal the learner included in this turn (US-58.1).
                    parts.append(TextContentPart(text=render_goal(message.goal)))
                if message.rubric is not None:
                    # The turn's pinned rubric (US-57.1), even if it was deleted since.
                    parts.append(TextContentPart(text=render_rubric(message.rubric.document)))
                for reference in message.files:
                    payload = payloads.get(reference.file_id)
                    if payload is None:
                        parts.append(TextContentPart(text=f'(attached file "{reference.name}" is no longer available)'))
                    elif payload.image_url is not None:
                        # The token lets the reply show the image again (ADR-0039).
                        parts.append(
                            TextContentPart(
                                text=f"Attached image: {reference.name} "
                                f"(reference: {file_reference_token(reference.file_id)})"
                            )
                        )
                        parts.append(ImageUrlContentPart(image_url=ImageUrlContent(url=payload.image_url)))
                    elif payload.text is not None:
                        parts.append(
                            TextContentPart(
                                text=f"### Attached file: {reference.name} "
                                f"(reference: {file_reference_token(reference.file_id)})\n{payload.text}"
                            )
                        )
                    else:
                        parts.append(
                            TextContentPart(text=f'(attached file "{reference.name}" not included: {payload.reason})')
                        )
                messages.append(LLMMessage(role="user", content=parts))
            for result in message.tool_call_results or []:
                messages.append(LLMMessage.tool_call_result(result))
        references = [
            reference for message in self.chat.messages if message.role == "user" for reference in message.files
        ]
        return messages, file_context(references, payloads)

    def _turn_template(self, index: int) -> TemplateProvenance | None:
        """The template label of the user turn this run answers, if any."""
        for message in reversed(self.chat.messages[: index + 1]):
            if message.role == "user":
                label = message.template
                return TemplateProvenance.model_validate(label.model_dump(exclude={"available"})) if label else None
        return None

    async def estimate_context_usage(self) -> ChatContextUsage:
        """Estimate the initial provider payload using the same runtime assembly.

        Character-based tokenization is intentionally labelled estimated; binary
        image payloads use a conservative fixed vision-token allowance instead.
        """
        messages = await self._build_agent_messages()
        system_prompt = await self.agent._build_system_prompt()
        if system_prompt:
            messages.insert(0, LLMMessage.system(system_prompt))

        model_name = self.chat.info.context_model.name if self.chat.info.context_model else None
        input_tokens = 0
        image_parts = 0
        for message in messages:
            if isinstance(message.content, str):
                input_tokens += estimate_text_tokens(message.content, model_name)
            else:
                for part in message.content:
                    if isinstance(part, TextContentPart):
                        input_tokens += estimate_text_tokens(part.text, model_name)
                    else:
                        image_parts += 1
            for tool_call in message.tool_calls or []:
                input_tokens += estimate_text_tokens(tool_call.model_dump_json(), model_name)

        # Tool schemas are part of the first agent request when tools are enabled.
        input_tokens += estimate_text_tokens(
            json.dumps(tool_registry.schemas(self.agent.effective_tools if self.agent.max_steps > 1 else [])),
            model_name,
        )
        input_tokens += image_parts * 765
        reserved_output = self.agent.profile.chat_parameters.get("max_tokens")
        return ChatContextUsage(
            input_tokens=input_tokens,
            reserved_output_tokens=reserved_output,
            total_tokens=input_tokens + (reserved_output or 0),
        )

    async def run_agent(self) -> None:
        try:
            self.is_processing_messages = True

            if not self.chat.messages:
                self.is_processing_messages = False
                return

            last_user_message_index = index_of(
                self.chat.messages,
                lambda m: m.role in {"user", "assistant"} and m.status == MessageStatus.PENDING,
                reverse=True,
            )
            if last_user_message_index < 0:
                self.is_processing_messages = False
                return

            parent_message_index = last_user_message_index
            parent_message = self.chat.messages[parent_message_index]
            self._comparison = self._column_of_current_turn()
            self.agent.parent_message_id = parent_message.id
            self._active_parent_id = parent_message.id
            self._streaming_content = ""
            self._streaming_thinking = ""
            self._delegations = DelegationCollector()
            self._context = None
            self._fork_step = None

            self._execution = await self.agent.prepare_execution(parent_message.id)
            await self.agent.prepare_execution_scope()
            replay = None
            if (
                self._execution is not None
                and self._execution.fork is not None
                and parent_message.id == self._execution.request_message_id
            ):
                # A pending fork replays its recorded step (ADR-0038). Until the
                # step is recorded it is not part of the history it runs on.
                replay = replayed_step(parent_message, self._execution)
                self._fork_step = parent_message
                self.chat.messages = self.chat.messages[:parent_message_index]
            messages, files = await self._assemble_agent_messages()
            self._context = turn_context(
                self.agent.prompt_snapshot,
                template=self._turn_template(last_user_message_index),
                files=files,
            )
            async for event in self.agent.run(messages=messages, replay=replay):
                match event:
                    case AgentEvent(type=AgentEventType.COMPLETE):
                        # An OpenAI-compatible provider can occasionally end a
                        # stream without text or tool calls.  Treating that as
                        # a normal completion used to persist one blank assistant
                        # message per agent step, leaving the chat unusable.
                        if not event.content.strip() and not event.has_tool_calls():
                            await self._emit(
                                {
                                    "type": AgentEventType.ERROR.value,
                                    "content": "The model returned an empty response. Please try again.",
                                },
                            )
                            return

                        if self._fork_step is not None:
                            new_message = await self._complete_fork_step(event)
                        else:
                            new_message = await chat_service.add_message(
                                user_id=self.user_id,
                                chat_id=self.chat_id,
                                message=NewMessageRequest(
                                    role="assistant",
                                    content=event.content,
                                    thinking=event.thinking,
                                    status=MessageStatus.COMPLETED,
                                    input_tokens=event.input_tokens,
                                    output_tokens=event.output_tokens,
                                    total_tokens=event.total_tokens,
                                    generation_duration_ms=event.generation_duration_ms,
                                    parent_message_id=parent_message.id,
                                    tool_calls=event.tool_calls if event.has_tool_calls() else None,
                                    tool_call_results=event.tool_results if event.has_tool_results() else None,
                                    delegations=self._delegations.drain() or None,
                                    context=step_context(self._context, event.tool_results) if self._context else None,
                                    execution=self._execution,
                                    model_id=self.agent.model_id,  # type:ignore
                                ),
                            )
                            parent_message.active_child_id = new_message.id
                            parent_message.status = MessageStatus.COMPLETED
                        self.chat.messages.append(new_message)

                        parent_message = new_message
                        parent_message_index = len(self.chat.messages) - 1

                        await self._emit(
                            {
                                "type": event.type.value,
                                "last_messages": [
                                    m.model_dump(mode="json") for m in self.chat.messages[last_user_message_index:]
                                ],
                            },
                        )

                    case AgentEvent(type=AgentEventType.SUB_AGENT):
                        if event.sub_agent:
                            self._delegations.observe(event.sub_agent)
                            await self._emit(
                                {
                                    "type": "sub_agent",
                                    **event.sub_agent.model_dump(mode="json", exclude={"event"}),
                                    "event": (event.sub_agent.event.model_dump(mode="json")),
                                },
                            )

                    case AgentEvent(type=AgentEventType.START):
                        await self._emit(
                            {
                                **event.model_dump(mode="json"),
                                "execution": self._execution.model_dump(mode="json") if self._execution else None,
                            },
                        )

                    case AgentEvent(type=AgentEventType.DELTA):
                        self._streaming_content = event.content
                        self._streaming_thinking = event.thinking
                        if is_exercise_run(self._execution):
                            # The exercise record is never streamed (ADR-0043).
                            event = event.model_copy(update={"content": streamed_text(event.content)})
                        await self._emit(event.model_dump())

                    case _:
                        await self._emit(event.model_dump())

        except asyncio.CancelledError:
            await self.cancel_active_generation()
            raise
        except Exception as e:
            self.logger.error(f"Error processing messages: {e}", stack_info=True)
            await self._emit({"type": AgentEventType.ERROR.value, "content": str(e)})
        finally:
            self._active_parent_id = None
            self._comparison = None
            self._fork_step = None
            self.is_processing_messages = False
