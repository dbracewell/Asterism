import asyncio
import uuid
from dataclasses import dataclass, field
from logging import Logger
from typing import Coroutine

from fastapi import WebSocket, WebSocketDisconnect
from fastapi.websockets import WebSocketState
from sqlalchemy.ext.asyncio import AsyncSession

import asterism.domains.chat.service as chat_service
import asterism.domains.settings.service as settings_service
from asterism.common.collection_utils import index_of
from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import AgentEventType
from asterism.domains.chat.cache import MessageQueue
from asterism.domains.chat.tasks import (
    create_new_user_message_task,
    generate_chat_title_task,
    heartbeat_task,
    process_message_queue_task,
    process_messages_task,
    regenerate_message_task,
    report_status_task,
)
from asterism.domains.chat.typedefs import ChatState
from asterism.domains.llm.schemas import LLMMessage

from .schemas import (
    Chat,
    MessageStatus,
    NewMessageRequest,
    UpdateMessageRequest,
)


async def run_chat_controller(state: ChatState) -> None:
    try:
        await state.websocket.accept()

        state.add_background_task(generate_chat_title_task(state))
        state.add_background_task(report_status_task(state))
        state.add_background_task(heartbeat_task(state))
        state.add_background_task(process_message_queue_task(state))

        if state.queue.qsize() == 0:
            state.add_pending_task(process_messages_task(state))

        while True:
            if state.is_processing:
                await asyncio.sleep(1)
                continue

            while state.has_pending_tasks:
                task = state.next_pending_task()
                while task.done() is False:
                    await asyncio.sleep(0.5)
                continue

            message_data = await state.websocket.receive_json()
            match message_data.get("type"):
                case "ping":
                    continue
                case "regenerate":
                    state.add_pending_task(
                        regenerate_message_task(
                            chat=state.chat,
                            message_id=message_data.get("message_id"),
                            websocket=state.websocket,
                        )
                    )
                    state.add_pending_task(process_messages_task(state))
                case "switch_active_id":
                    pass
                case "chat":
                    state.add_pending_task(
                        create_new_user_message_task(state=state, message=message_data)
                    )
                    state.add_pending_task(process_messages_task(state))
            await asyncio.sleep(1)

    except WebSocketDisconnect:
        state.logger.info("Chat stream disconnected for session")
    except asyncio.CancelledError:
        state.logger.info("Shutting down WebSocket listener...")
        raise
    except Exception as e:
        state.logger.error(e)
        await state.websocket.send_json(
            {"type": AgentEventType.ERROR.value, "content": str(e)}
        )
    finally:
        for task in state.background_tasks:
            task.cancel()


@dataclass
class ChatController:
    websocket: WebSocket
    chat_session: Chat
    agent: Agent
    queue: MessageQueue
    logger: Logger
    background_tasks: list[asyncio.Task] = field(default_factory=list)
    task_queue: list[Coroutine] = field(default_factory=list)
    is_processing_messages: bool = False

    def is_processing(self) -> bool:
        return (
            self.queue.qsize() > 0
            or len(self.task_queue) > 0
            or self.is_processing_messages
        )

    async def _process_messages(self) -> None:
        try:
            self.is_processing_messages = True

            if not self.chat_session.messages:
                self.is_processing_messages = False
                return

            last_user_message_index = index_of(
                self.chat_session.messages,
                lambda m: m.role == "user" and m.status == MessageStatus.PENDING,
                reverse=True,
            )

            if last_user_message_index < 0:
                self.is_processing_messages = False
                return

            parent_message_index = last_user_message_index
            parent_message = self.chat_session.messages[parent_message_index]

            messages: list[LLMMessage] = []
            for m in self.chat_session.messages:
                messages.append(LLMMessage(**m.model_dump()))
                for tr in m.tool_call_results or []:
                    messages.append(LLMMessage.tool_call_result(tr))

            async for event in self.agent.run(messages=messages):
                if event.type == AgentEventType.TOOL_CALL and event.user_response_queue:
                    await self.queue.put(event.model_dump(mode="json"))
                    for tool in event.user_response_queue.pending:
                        event.user_response_queue.respond(tool, True)
                    continue

                if event.type in (
                    AgentEventType.COMPLETE,
                    AgentEventType.TOOL_COMPLETE,
                ):
                    new_message = await chat_service.add_message(
                        user_id=self.chat_session.info.user_id,
                        chat_id=self.chat_session.info.id,
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
                    parent_message = await chat_service.update_message(
                        user_id=self.chat_session.info.user_id,
                        chat_id=self.chat_session.info.id,
                        message_id=parent_message.id,
                        payload=UpdateMessageRequest(
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
                            {
                                "type": AgentEventType.TOOL_COMPLETE.value,
                                "tool_results": [
                                    tr.to_dict() for tr in event.tool_results
                                ],
                            }
                        )
                else:
                    await self.queue.put(event.model_dump())

        except asyncio.CancelledError:
            raise
        except Exception as e:
            self.logger.error(
                f"Error processing messages {e}",
                stack_info=True,
            )
            await self.queue.put(
                {"type": AgentEventType.ERROR.value, "content": str(e)}
            )
        finally:
            self.is_processing_messages = False

    async def _handle_change_active_id(
        self,
        parent_id: uuid.UUID,
        active_id: uuid.UUID,
    ) -> None:
        await chat_service.update_message(
            user_id=self.agent.user.id,
            chat_id=self.chat_session.info.id,
            message_id=parent_id,
            payload=UpdateMessageRequest(active_child_id=active_id),
        )
        self.chat_session = await chat_service.get_one(
            user_id=self.agent.user.id,
            chat_id=self.chat_session.info.id,
        )

    async def __call__(self) -> None:
        try:
            await self.websocket.accept()
            if self.queue.qsize() == 0:
                self.task_queue.append(self._process_messages())

            while self.websocket.client_state == WebSocketState.CONNECTED:
                if self.is_processing_messages or self.queue.qsize() > 0:
                    await asyncio.sleep(1)
                    continue
                elif self.task_queue:
                    next_task = self.task_queue.pop(0)
                    task = asyncio.create_task(next_task)
                    while task.done() is False:
                        await asyncio.sleep(0.5)
                    continue

                message_data = await self.websocket.receive_json()
                match message_data.get("type"):
                    case "ping":
                        continue
                    case "regenerate":
                        self.task_queue.extend(
                            [
                                regenerate_message_task(
                                    chat=self.chat_session,
                                    message_id=message_data.get("message_id"),
                                    websocket=self.websocket,
                                ),
                                self._process_messages(),
                            ]
                        )
                    case "switch_active_id":
                        self.task_queue.append(
                            self._handle_change_active_id(
                                active_id=uuid.UUID(message_data.get("active_id")),
                                parent_id=uuid.UUID(message_data.get("parent_id")),
                            )
                        )
                    case "chat":
                        self.task_queue.extend(
                            [
                                create_new_user_message_task(
                                    chat=self.chat_session,
                                    message=message_data,
                                    model_id=self.agent.profile.model_id,
                                ),
                                self._process_messages(),
                            ]
                        )

        except WebSocketDisconnect:
            self.logger.info("Chat stream disconnected for session")
        except asyncio.CancelledError:
            self.logger.info("Shutting down WebSocket listener...")
            raise
        except Exception as e:
            self.logger.error(e)
            await self.websocket.send_json(
                {"type": AgentEventType.ERROR.value, "content": str(e)}
            )
        finally:
            for task in self.background_tasks:
                task.cancel()


async def create_chat_controller(
    websocket: WebSocket,
    user: AuthedUser,
    chat_id: uuid.UUID,
    session: AsyncSession,
) -> ChatState:
    chat_session = await chat_service.get_one(
        chat_id=chat_id,
        user_id=user.id,
        session=session,
    )
    user_settings = await settings_service.get_user_settings(
        user_id=user.id,
        session=session,
    )
    agent_profile = user_settings.default_agent_profile
    if agent_profile is None:
        raise BadDataException("User does not have a default agent profile set.")

    agent: Agent = Agent(profile=agent_profile, user=user)

    controller = ChatState(
        websocket=websocket,
        chat=chat_session,
        agent=agent,
        logger=get_logger(f"CHAT_{chat_session.info.id}"),
    )
    return controller
