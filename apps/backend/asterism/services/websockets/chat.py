import asyncio
import uuid
from logging import Logger
from typing import Any

from cachetools import TTLCache
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.websockets import WebSocketState

from asterism.common import LLMMessage
from asterism.events import (
    ChatUpdateEvent,
    Event,
    EventType,
    event_bus,
)
from asterism.llm import Agent, AgentEventType
from asterism.llm.draft import get_draft_model
from asterism.models.message import MessageStatus
from asterism.repositories import chat_repository
from asterism.schemas import (
    ChatModel,
    ChatUpdateRequest,
    MessageModel,
    NewMessage,
    UpdateMessage,
)
from asterism.utils.collection_utils import index_of
from asterism.utils.log import get_logger

type MessageQueue = asyncio.Queue[dict[str, Any]]

_queue_cache: TTLCache[uuid.UUID, MessageQueue] = TTLCache[uuid.UUID, MessageQueue](
    maxsize=1000, ttl=8600
)


def _get_or_create_queue(chat_id: uuid.UUID) -> MessageQueue:
    queue = _queue_cache.get(chat_id)
    if queue:
        return queue
    queue = asyncio.Queue[dict[str, Any]]()
    _queue_cache[chat_id] = queue
    return queue


class AgentRunnerWebsocket:
    def __init__(
        self,
        websocket: WebSocket,
        chat_session: ChatModel,
        agent: Agent,
    ) -> None:
        self.websocket: WebSocket = websocket
        self.chat_session: ChatModel = chat_session
        self.agent = agent
        self.queue: MessageQueue = _get_or_create_queue(chat_session.info.id)
        self.logger: Logger = get_logger(f"CHAT_{self.chat_session.info.id}")
        self.background_tasks: list[asyncio.Task] = []

    async def _generate_title(self) -> None:
        if (
            not self.chat_session.info.title
            or self.chat_session.info.title == "New Chat"
        ):
            try:
                draft_model = get_draft_model()
                title = await draft_model.label_chat(
                    self.chat_session.messages[0].content
                )
            except Exception as e:
                self.logger.error(e, stack_info=True)
                return

            self.chat_session.info.title = title
            await chat_repository.update(
                user_id=self.chat_session.info.user_id,
                session_id=self.chat_session.info.id,
                update=ChatUpdateRequest(title=self.chat_session.info.title),
            )
            event_bus.emit(
                Event(
                    type=EventType.WEBHOOK_CHAT_UPDATE,
                    payload=ChatUpdateEvent(
                        session_id=self.chat_session.info.id,
                        title=self.chat_session.info.title,
                    ),
                    user_id=self.chat_session.info.user_id,
                )
            )

    async def _process_messages(self) -> None:
        try:
            if not self.chat_session.messages:
                await asyncio.sleep(0.5)
                return

            last_user_message_index = index_of(
                self.chat_session.messages,
                lambda m: m.role == "user" and m.status == MessageStatus.PENDING,
                reverse=True,
            )

            if last_user_message_index < 0:
                await asyncio.sleep(0.5)
                return

            parent_message_index = last_user_message_index
            parent_message = self.chat_session.messages[parent_message_index]

            messages: list[LLMMessage] = []
            for m in self.chat_session.messages:
                messages.append(LLMMessage(**m.model_dump()))
                for tr in m.tool_results or []:
                    messages.append(LLMMessage.tool_call_result(tr))

            async for event in self.agent.run(messages=messages):
                if event.type in (
                    AgentEventType.COMPLETE,
                    AgentEventType.TOOL_COMPLETE,
                ):
                    new_message = await chat_repository.add_message(
                        user_id=self.chat_session.info.user_id,
                        session_id=self.chat_session.info.id,
                        message=NewMessage(
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
                    parent_message = await chat_repository.update_message(
                        user_id=self.chat_session.info.user_id,
                        session_id=self.chat_session.info.id,
                        message_id=parent_message.id,
                        payload=UpdateMessage(
                            active_child_id=new_message.id,
                            status=MessageStatus.COMPLETED,
                        ),
                    )

                    self.chat_session.messages.append(new_message)
                    self.chat_session.messages[parent_message_index] = parent_message
                    parent_message = new_message
                    parent_message_index = len(self.chat_session.messages) - 1

                    if event.type == AgentEventType.COMPLETE:
                        await self.queue.put(
                            {
                                "type": event.type.value,
                                "last_messages": [
                                    m.model_dump(mode="json")
                                    for m in self.chat_session.messages[
                                        last_user_message_index:
                                    ]
                                ],
                            }
                        )
                    else:
                        await self.queue.put(
                            {"type": AgentEventType.TOOL_COMPLETE.value}
                        )
                else:
                    await self.queue.put(event.model_dump())

        except asyncio.CancelledError:
            pass
        except Exception as e:
            self.logger.error(e)
            await self.queue.put(
                {"type": AgentEventType.ERROR.value, "content": str(e)}
            )

    async def process_queue(self) -> None:
        event_sequence: set[AgentEventType] = set()

        while True:
            msg = await self.queue.get()
            msg_type = AgentEventType(msg["type"])
            event_sequence.add(msg_type)

            match msg_type:
                case AgentEventType.START:
                    await self.websocket.send_json(msg)
                    continue
                case AgentEventType.COMPLETE | AgentEventType.ERROR:
                    event_sequence.clear()
                    await self.websocket.send_json(msg)
                    continue
                case AgentEventType.TOOL_COMPLETE:
                    continue

            if (
                AgentEventType.START in event_sequence
                or AgentEventType.TOOL_COMPLETE in event_sequence
            ):
                await self.websocket.send_json(msg)
            else:
                event_sequence.add(AgentEventType.START)
                await self.websocket.send_json({"type": AgentEventType.START.value})
                await self.websocket.send_json(msg)

    async def _heartbeat(self) -> None:
        while True:
            await self.websocket.send_json({"type": "HEARTBEAT"})
            await asyncio.sleep(30)

    async def open(self) -> None:

        try:
            await self.websocket.accept()
            self.background_tasks.append(
                asyncio.create_task(self._heartbeat()),
            )
            self.background_tasks.append(asyncio.create_task(self._generate_title()))

            if self.queue.qsize() == 0:
                # Process any messages that are in the db
                asyncio.create_task(self._process_messages())

            self.background_tasks.append(asyncio.create_task(self.process_queue()))

            while self.websocket.client_state == WebSocketState.CONNECTED:
                message_data = await self.websocket.receive_json()
                if "command" in message_data:
                    command = message_data["command"]
                    if command == "regenerate":
                        message_id = message_data.get("message_id")
                        parent_message_index = index_of(
                            self.chat_session.messages,
                            lambda m: str(m.active_child_id) == message_id,
                        )
                        if parent_message_index < 0:
                            continue

                        parent_message = self.chat_session.messages[
                            parent_message_index
                        ]
                        parent_message = await chat_repository.update_message(
                            user_id=self.agent.user.id,
                            session_id=self.chat_session.info.id,
                            message_id=parent_message.id,
                            payload=UpdateMessage(
                                drop_active_child_id=True,
                                status=MessageStatus.PENDING,
                            ),
                        )

                        self.chat_session.messages = self.chat_session.messages[
                            :parent_message_index
                        ]
                        self.chat_session.messages.append(parent_message)

                        await self.websocket.send_json(
                            {
                                "type": "regenerate",
                                "parent_id": str(parent_message.id),
                            }
                        )
                        asyncio.create_task(self._process_messages())
                        continue

                if "message" not in message_data:
                    continue

                while self.queue.qsize() > 0:
                    await asyncio.sleep(1)

                user_prompt = message_data.get("message", "")
                user_message = await chat_repository.add_message(
                    user_id=self.chat_session.info.user_id,
                    session_id=self.chat_session.info.id,
                    message=NewMessage(
                        role="user",
                        content=user_prompt,
                        token_count=len(user_prompt),
                        parent_message_id=self.chat_session.messages[-1].id
                        if self.chat_session.messages
                        else None,
                        status=MessageStatus.PENDING,
                        model_id=self.agent.profile.model_id,
                    ),
                )
                self.chat_session.messages.append(
                    MessageModel.model_validate(user_message)
                )
                # Process the new message
                asyncio.create_task(self._process_messages())

        except WebSocketDisconnect:
            print("Chat stream disconnected for session")
        except asyncio.CancelledError:
            print("Shutting down WebSocket listener...")
            raise
        except Exception as e:
            self.logger.error(e)
            await self.websocket.send_json(
                {"type": AgentEventType.ERROR.value, "content": str(e)}
            )
        finally:
            for task in self.background_tasks:
                task.cancel()
