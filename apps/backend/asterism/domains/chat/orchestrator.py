import asyncio
import uuid
from logging import Logger

import asterism.domains.chat.service as chat_service
from asterism.common.collection_utils import index_of
from asterism.common.log import get_logger
from asterism.common.strings import is_none_or_empty
from asterism.core.events import ChatUpdateEvent, Event, EventType, event_bus
from asterism.core.exceptions import BadDataException
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import AgentEvent, AgentEventType
from asterism.domains.agent.user_response_queue import UserResponseQueue
from asterism.domains.chat.message_queue import MessageQueue, get_message_queue
from asterism.domains.chat.schemas import (
    Chat,
    ChatUpdateRequest,
    Message,
    MessageStatus,
    NewMessageRequest,
    UpdateMessageRequest,
)
from asterism.domains.llm.draft import get_draft_model
from asterism.domains.llm.schemas import LLMMessage, ToolCall


class ChatOrchestrator:
    def __init__(
        self,
        chat: Chat,
        agent: Agent,
    ):
        self.chat: Chat = chat
        self.agent: Agent = agent
        self.logger: Logger = get_logger(f"ChatSession({str(self.chat.info.id)})")
        self.is_processing_messages: bool = False
        self.pending_approvals: dict[str, asyncio.Future] = {}

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

    async def handle_new_user_message(self, text: str) -> None:
        parent_message_id = self.chat.messages[-1].id if self.chat.messages else None

        user_message = await chat_service.add_message(
            user_id=self.user_id,
            chat_id=self.chat_id,
            message=NewMessageRequest(
                role="user",
                content=text,
                token_count=len(text),
                parent_message_id=parent_message_id,
                status=MessageStatus.PENDING,
                model_id=self.agent.profile.model_id,
            ),
        )
        self.chat.messages.append(Message.model_validate(user_message))
        await self.run_agent()

    def find_message(self, message_id: str) -> tuple[int, Message]:
        message_index = index_of(
            self.chat.messages,
            lambda m: str(m.id) == message_id,
        )
        if message_index < 0:
            raise BadDataException(f"Message not for id {message_id}")
        return message_index, self.chat.messages[message_index]

    async def handle_regenerate_message(self, parent_message_index: int) -> None:
        parent_message = self.chat.messages[parent_message_index]
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

    async def generate_chat_title(self) -> None:
        if (
            not is_none_or_empty(self.chat.info.title)
            and self.chat.info.title != "New Chat"
        ):
            return

        try:
            draft_model = get_draft_model()
            content = await draft_model.invoke(
                messages=[
                    LLMMessage.user(
                        content=f"""You are a title generation assistant. Generate a short, descriptive chat title (3 to 6 words) that captures the intent of the user's message/question. Output strictly the title itself with no quotes, no prefixes, and no trailing punctuation. Do not repeat the user's text and do not answer the user's questions or requests. Only generate a generic title that labels the intent of the user. Do not think about how to answer.
                        
                        User Prompt: {self.chat.messages[0].content}""",  # noqa: E501
                    ),
                ],
                max_tokens=15,
                thinking_budget_tokens=5,
            )
            self.chat.info.title = content.strip()
            await chat_service.update_chat(
                user_id=self.user_id,
                chat_id=self.chat_id,
                payload=ChatUpdateRequest(title=self.chat.info.title),
            )
            event_bus.emit(
                Event(
                    type=EventType.WEBHOOK_CHAT_UPDATE,
                    payload=ChatUpdateEvent(
                        session_id=self.chat_id,
                        title=self.chat.info.title,
                    ),
                    user_id=self.user_id,
                )
            )
        except Exception as e:
            self.logger.error(f"Error generating chat title {e}", stack_info=True)

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

            messages: list[LLMMessage] = []
            for m in self.chat.messages:
                messages.append(LLMMessage(**m.model_dump()))
                for tr in m.tool_call_results or []:
                    messages.append(LLMMessage.tool_call_result(tr))

            async for event in self.agent.run(messages=messages):
                match event:
                    case AgentEvent(
                        type=AgentEventType.TOOL_CALL,
                        user_response_queue=queue,
                    ) if queue is not None:
                        # Get user ok to run tools
                        await self.queue.put(event.model_dump(mode="json"))
                        tasks = []
                        for tool in queue.pending:
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
                        continue

                    case AgentEvent(type=AgentEventType.COMPLETE):
                        new_message = await chat_service.add_message(
                            user_id=self.user_id,
                            chat_id=self.chat_id,
                            message=NewMessageRequest(
                                role="assistant",
                                content=event.content,
                                thinking=event.thinking,
                                status=MessageStatus.COMPLETED,
                                token_count=event.total_tokens,
                                parent_message_id=parent_message.id,
                                tool_calls=event.tool_calls
                                if event.has_tool_calls()
                                else None,
                                tool_call_results=event.tool_results
                                if event.has_tool_results()
                                else None,
                                model_id=self.agent.profile.model_id,
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
                                    m.model_dump(mode="json")
                                    for m in self.chat.messages[
                                        last_user_message_index:
                                    ]
                                ],
                            }
                        )

                    case _:
                        await self.queue.put(event.model_dump())

        except Exception as e:
            self.logger.error(f"Error processing messages: {e}", stack_info=True)
            await self.queue.put(
                {"type": AgentEventType.ERROR.value, "content": str(e)}
            )
        finally:
            self.is_processing_messages = False
