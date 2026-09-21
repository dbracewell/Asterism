from __future__ import annotations

import asyncio
import base64
import json
import uuid
from logging import Logger
from typing import TYPE_CHECKING

from sqlalchemy import select

import asterism.domains.chat.service as chat_service
from asterism.common.collection_utils import index_of
from asterism.common.log import get_logger
from asterism.common.strings import is_none_or_empty
from asterism.core import config
from asterism.core.events import ChatUpdateEvent, Event, EventType, event_bus
from asterism.core.exceptions import BadDataException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.approval import InteractiveApprovalPolicy
from asterism.domains.agent.schemas import AgentEvent, AgentEventType
from asterism.domains.chat.message_queue import MessageQueue, get_message_queue
from asterism.domains.chat.schemas import (
    Chat,
    ChatContextUsage,
    ChatUpdateRequest,
    Message,
    MessageFileReference,
    MessageStatus,
    NewMessageRequest,
    UpdateMessageRequest,
)
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.service import ensure_file_processed
from asterism.domains.llm.draft import get_draft_model
from asterism.domains.llm.schemas import (
    ImageUrlContent,
    ImageUrlContentPart,
    LLMMessage,
    TextContentPart,
    ToolCall,
)
from asterism.domains.llm.token_counting import estimate_text_tokens
from asterism.domains.settings import service as settings_service
from asterism.domains.tools.registry import tool_registry

if TYPE_CHECKING:
    from asterism.domains.agent.user_response_queue import UserResponseQueue


class ChatOrchestrator:
    def __init__(
        self,
        agent: Agent,
    ):
        self.chat: Chat = agent.session
        self.agent: Agent = agent
        self.logger: Logger = get_logger(f"ChatSession({str(self.chat.info.id)})")
        self.is_processing_messages: bool = False
        self.pending_approvals: dict[str, asyncio.Future] = {}
        self._active_parent_id: uuid.UUID | None = None
        self._streaming_content = ""
        self._streaming_thinking = ""

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

    async def handle_new_user_message(self, text: str, filenames: list[str] | None = None) -> None:
        files = await self._resolve_files(filenames or [])
        parent_message_id = self.chat.messages[-1].id if self.chat.messages else None

        user_message: Message = await chat_service.add_message(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message=NewMessageRequest(
                role="user",
                content=text,
                parent_message_id=parent_message_id,
                status=MessageStatus.PENDING,
                model_id=self.agent.profile.model_id,  # type:ignore
                files=files,
            ),
        )
        self.chat.messages.append(Message.model_validate(user_message))
        self.agent.user_files = [file.filename for file in files]
        await self.run_agent()

    async def _resolve_files(self, filenames: list[str]):
        if len(filenames) != len(set(filenames)):
            raise BadDataException("Attached files must not be repeated")
        if not filenames:
            return []

        async with get_async_db_session() as session:
            records = list(
                await session.scalars(
                    select(UserFileModel).where(
                        UserFileModel.user_id == self.user_id,
                        UserFileModel.filename.in_(filenames),
                    )
                )
            )
            found = {file.filename: file for file in records}
            if any(filename not in found for filename in filenames):
                raise BadDataException("One or more attached files are unavailable")
            resolved = []
            for filename in filenames:
                file = await ensure_file_processed(file=found[filename], session=session)
                resolved.append(
                    MessageFileReference(
                        filename=file.filename,
                        name=file.original_name,
                        mime_type=file.mime_type,
                        size=file.size,
                        kind=file.kind,
                        status=file.content_status,
                    )
                )
            return resolved

    async def cancel_active_generation(self) -> None:
        """Finalize the active user turn so reconnecting never re-runs it."""
        parent_id = self._active_parent_id
        if parent_id is None:
            return

        parent_index = index_of(self.chat.messages, lambda message: message.id == parent_id)

        # Retain useful streamed output rather than silently discarding it.
        if self._streaming_content or self._streaming_thinking:
            partial = await chat_service.add_message(
                user_id=self.user_id,
                chat_id=self.chat_id,
                message=NewMessageRequest(
                    role="assistant",
                    content=self._streaming_content,
                    thinking=self._streaming_thinking,
                    status=MessageStatus.CANCELLED,
                    parent_message_id=parent_id,
                    model_id=self.agent.profile.model_id,  # type: ignore
                ),
            )
            self.chat.messages.append(partial)

        # add_message marks its parent complete when it attaches a child, so
        # write the terminal user-visible cancellation state last.
        parent = await chat_service.update_message(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message_id=parent_id,
            payload=UpdateMessageRequest(status=MessageStatus.CANCELLED),
        )
        if parent_index >= 0:
            self.chat.messages[parent_index] = parent

        await self.queue.put(
            {
                "type": AgentEventType.COMPLETE.value,
                "last_messages": [message.model_dump(mode="json") for message in self.chat.messages[parent_index:]],
            }
        )
        self._active_parent_id = None

    def find_message(self, message_id: str) -> tuple[int, Message]:
        message_index: int = index_of(
            self.chat.messages,
            lambda m: str(m.id) == message_id,
        )
        if message_index < 0:
            raise BadDataException(f"Message not for id {message_id}")
        return message_index, self.chat.messages[message_index]

    async def handle_regenerate_message(self, parent_message_index: int) -> None:
        parent_message: Message = self.chat.messages[parent_message_index]
        parent_message = await chat_service.update_message(
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

    def _fallback_title(self) -> str:
        prompt = next(
            (message.content for message in self.chat.messages if message.role == "user"),
            "New chat",
        )
        # A deterministic, non-empty fallback is more useful than an untitled
        # chat and avoids exposing an unbounded provider retry to the user.
        normalized = " ".join(str(prompt).split())
        return normalized[:80] or "New chat"

    async def _save_chat_title(self, title: str) -> None:
        self.chat.info.title = title
        await chat_service.update_chat(
            user_id=self.user_id,
            chat_id=self.chat_id,
            payload=ChatUpdateRequest(title=title),
        )
        event_bus.emit(
            Event(
                type=EventType.WEBHOOK_CHAT_UPDATE,
                payload=ChatUpdateEvent(session_id=self.chat_id, title=title),
                user_id=self.user_id,
            )
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
        if not is_none_or_empty(self.chat.info.title):
            return

        title = ""
        try:
            draft_model = get_draft_model()
            for _ in range(3):
                try:
                    async with asyncio.timeout(15):
                        candidate = await draft_model.invoke(
                            messages=[
                                LLMMessage.user(
                                    content=f"""You are a title generation assistant.
Generate a short, descriptive chat title (3 to 6 words) that captures the intent
of the user's message/question. Output strictly the title itself with no quotes,
no prefixes, and no trailing punctuation. Do not answer the user's request.

User Prompt: {self._fallback_title()}""",
                                ),
                            ],
                        )
                    title = self._validated_title(candidate)
                    if title:
                        break
                except Exception as error:
                    self.logger.warning("Chat title attempt failed: %s", error)
        except Exception as error:
            self.logger.warning("Chat title setup failed: %s", error)

        await self._save_chat_title(title or self._fallback_title())

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
            await self.queue.put(
                {
                    "type": "tool_permission_request",
                    "id": tool.id,
                    "name": tool.function.name,
                    "arguments": tool.function.arguments,
                }
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
            await self.queue.put({"type": "tool_update", "id": tool.id})
        finally:
            self.pending_approvals.pop(tool.id, None)

    def resolve_tool_approval(self, tool_id: str, approved: bool) -> None:
        future = self.pending_approvals.get(tool_id)
        if future and not future.done():
            future.set_result(approved)

    async def save_always_allow_preference(self, tool_id: str) -> None:
        pass

    async def _build_agent_messages(self) -> list[LLMMessage]:
        files_by_name: dict[str, UserFileModel] = {}
        names = [file.filename for message in self.chat.messages for file in message.files]
        vision_enabled = False
        if names:
            if self.agent.profile.model_id:
                model = await settings_service.get_model_and_provider(model_id=self.agent.profile.model_id)
                vision_enabled = model.supports_vision is True
            async with get_async_db_session() as session:
                records = await session.scalars(
                    select(UserFileModel).where(
                        UserFileModel.user_id == self.user_id,
                        UserFileModel.filename.in_(names),
                    )
                )
                files_by_name = {file.filename: file for file in records}

        messages: list[LLMMessage] = []
        for message in self.chat.messages:
            if message.role != "user" or not message.files:
                messages.append(LLMMessage(**message.model_dump()))
            else:
                parts: list[TextContentPart | ImageUrlContentPart] = [TextContentPart(text=message.content)]
                for reference in message.files:
                    file = files_by_name.get(reference.filename)
                    if file is None:
                        parts.append(TextContentPart(text=f'(attached file "{reference.name}" is no longer available)'))
                    elif file.kind.value == "image":
                        path = config.files_root / self.user_id / file.filename
                        if vision_enabled and path.is_file() and file.size <= config.max_vision_image_bytes:
                            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
                            parts.append(
                                ImageUrlContentPart(
                                    image_url=ImageUrlContent(url=f"data:{file.mime_type};base64,{encoded}")
                                )
                            )
                        elif vision_enabled:
                            parts.append(
                                TextContentPart(
                                    text=f'(image "{reference.name}" not included: file is too large or unavailable)'
                                )
                            )
                        else:
                            parts.append(
                                TextContentPart(
                                    text=f'(image "{reference.name}" not included: model does not support image input)'
                                )
                            )
                    elif file.content_cache:
                        parts.append(TextContentPart(text=f"### Attached file: {reference.name}\n{file.content_cache}"))
                    else:
                        reason = file.content_error or "file type is unsupported"
                        parts.append(TextContentPart(text=f'(attached file "{reference.name}" not included: {reason})'))
                messages.append(LLMMessage(role="user", content=parts))
            for result in message.tool_call_results or []:
                messages.append(LLMMessage.tool_call_result(result))
        return messages

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
            json.dumps(tool_registry.schemas(self.agent.profile.tools)), model_name
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
                lambda m: m.role == "user" and m.status == MessageStatus.PENDING,
                reverse=True,
            )
            if last_user_message_index < 0:
                self.is_processing_messages = False
                return

            parent_message_index = last_user_message_index
            parent_message = self.chat.messages[parent_message_index]
            self.agent.parent_message_id = parent_message.id
            self._active_parent_id = parent_message.id
            self._streaming_content = ""
            self._streaming_thinking = ""

            messages = await self._build_agent_messages()

            async for event in self.agent.run(messages=messages):
                match event:
                    case AgentEvent(type=AgentEventType.COMPLETE):
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
                                model_id=self.agent.profile.model_id,  # type:ignore
                            ),
                        )
                        parent_message.active_child_id = new_message.id
                        parent_message.status = MessageStatus.COMPLETED
                        self.chat.messages.append(new_message)

                        parent_message = new_message
                        parent_message_index = len(self.chat.messages) - 1

                        await self.queue.put(
                            {
                                "type": event.type.value,
                                "last_messages": [
                                    m.model_dump(mode="json") for m in self.chat.messages[last_user_message_index:]
                                ],
                            }
                        )

                    case AgentEvent(type=AgentEventType.SUB_AGENT):
                        if event.sub_agent:
                            await self.queue.put(
                                {
                                    "type": "sub_agent",
                                    "execution_id": str(event.sub_agent.execution_id),
                                    "sub_agent_id": str(event.sub_agent.sub_agent_id),
                                    "sub_agent_name": (event.sub_agent.sub_agent_name),
                                    "depth": event.sub_agent.depth,
                                    "event": (event.sub_agent.event.model_dump(mode="json")),
                                }
                            )

                    case AgentEvent(type=AgentEventType.DELTA):
                        self._streaming_content = event.content
                        self._streaming_thinking = event.thinking
                        await self.queue.put(event.model_dump())

                    case _:
                        await self.queue.put(event.model_dump())

        except asyncio.CancelledError:
            await self.cancel_active_generation()
            raise
        except Exception as e:
            self.logger.error(f"Error processing messages: {e}", stack_info=True)
            await self.queue.put({"type": AgentEventType.ERROR.value, "content": str(e)})
        finally:
            self._active_parent_id = None
            self.is_processing_messages = False
