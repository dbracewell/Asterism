import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from cachetools import TTLCache
from fastapi import WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.events import ChatUpdateEvent, Event, EventType, event_bus
from asterism.core.llm.client import LLMClient, LLMEvent, LLMEventType
from asterism.core.llm.draft import get_draft_model
from asterism.core.models import ChatModel, LLMMessage, MessageModel
from asterism.core.models.message import MessageStatus
from asterism.core.registries.tool import ToolCall, ToolResult, tool_registry
from asterism.core.repositories import chat_repository, settings_repository
from asterism.core.services.schemas import ChatUpdateRequest
from asterism.core.services.schemas.message import (
    NewMessage,
    UpdateMessage,
)
from asterism.core.typedefs import AuthedUser
from asterism.core.utils.log import get_logger


@dataclass
class LLMFinalResponse:
    thinking: str
    event: LLMEvent
    total_tokens: int
    tokens_per_second: float
    tool_calls: list[ToolCall] | None = field(default=None)


class WebSocketResponse(BaseModel):
    type: Literal[
        "STREAM_START",
        "STREAM_END",
        "TEXT_DELTA",
        "THINKING_COMPLETE",
        "THINKING_DELTA",
        "THINKING_COMPLETE",
        "COMPLETE",
        "PARSE_ERROR",
        "ERROR",
        "TOOL_CALL_COMPLETE",
    ]
    content: str | list[dict[str, Any]] | None = Field(default=None)
    tool_calls: list[dict[str, Any]] | None = Field(default=None)


_queue_cache = TTLCache[uuid.UUID, asyncio.Queue](maxsize=1000, ttl=8600)


class WebSocketChatConnection:
    def __init__(
        self,
        websocket: WebSocket,
        db_session: AsyncSession,
        chat_session: ChatModel,
        user: AuthedUser,
    ):
        self.websocket = websocket
        self.session = db_session
        self.chat_session: ChatModel = chat_session
        self.user = user
        if chat_session.info.id in _queue_cache:
            self.queue: asyncio.Queue = _queue_cache.get(chat_session.info.id)  # type:ignore
        else:
            self.queue = asyncio.Queue()
            _queue_cache[chat_session.info.id] = self.queue

        self.client: LLMClient | None = None
        self.logger = get_logger(f"CHAT_{self.chat_session.info.id}")

    async def _get_client(self) -> LLMClient:
        if self.client is None:
            user_settings = await settings_repository.get_user_settings(self.user.id)
            app_settings = await settings_repository.get_app_settings(self.session)
            if not user_settings.chat_model:
                raise ValueError("No Chat Model")
            provider = app_settings.get_provider(user_settings.chat_model.provider_id)
            self.client = LLMClient(
                api_key=provider.api_key,
                llm_host=provider.base_url,
                model_name=user_settings.chat_model.name,
            )
        return self.client  # type: ignore

    async def _generate_title(self) -> None:
        if (
            self.chat_session.info.title is None
            or self.chat_session.info.title == "New Chat"
        ):
            title = "New Chat"
            try:
                draft_model = get_draft_model()
                title = await draft_model.label_chat(
                    self.chat_session.messages[0].content
                )
            except Exception as e:
                self.logger.error(e)

            self.chat_session.info.title = title or "New Chat"
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

    async def _process_messages(self, processing_tools: bool = False) -> None:
        try:
            if not self.chat_session.messages:
                await self.queue.put({"type": "SKIP"})
                return

            last_user_message_index = -1
            for i in range(len(self.chat_session.messages) - 1, -1, -1):
                msg = self.chat_session.messages[i]
                if msg.role == "user":
                    if processing_tools or msg.status == MessageStatus.PENDING:
                        last_user_message_index = i
                    break

            if last_user_message_index == -1:
                await self.queue.put({"type": "SKIP"})
                return

            await self.queue.put({"type": "STREAM_START"})

            messages: list[LLMMessage] = [
                LLMMessage.system(
                    "You are helpful assistant. When you do not know an answer "
                    "you should use an available tool."
                )
            ]
            messages.extend(self.chat_session.messages)
            response = await self.generate_response(messages=messages)

            ai_message = await chat_repository.add_message(
                user_id=self.chat_session.info.user_id,
                session_id=self.chat_session.info.id,
                message=NewMessage(
                    role="assistant",
                    content=response.event.content or "",
                    token_count=response.event.total_tokens or 0,
                    thinking=response.thinking,
                    parent_message_id=self.chat_session.messages[-1].id,
                    status=MessageStatus.COMPLETED,
                    tool_calls=response.tool_calls,
                ),
                session=self.session,
            )

            last_message = await chat_repository.update_message(
                user_id=self.chat_session.info.user_id,
                session_id=self.chat_session.info.id,
                message_id=self.chat_session.messages[-1].id,
                payload=UpdateMessage(
                    status=MessageStatus.COMPLETED,
                    active_child_id=ai_message.id,
                ),
                session=self.session,
            )

            last_message_model = MessageModel.model_validate(last_message)
            ai_message_model = MessageModel.model_validate(ai_message)
            self.chat_session.messages[-1] = last_message_model
            self.chat_session.messages.append(ai_message_model)

            # Update the last user message to be completed in case it is not (tool call)
            self.chat_session.messages[
                last_user_message_index
            ].status = MessageStatus.COMPLETED

            event_type = "STREAM_END"
            if response.tool_calls:
                event_type = "STREAM_PRE_TOOLS"

            await self.queue.put(
                {
                    "type": event_type,
                    "tokens_per_second": response.tokens_per_second,
                    "content": json.dumps(
                        [
                            m.model_dump(mode="json")
                            for m in self.chat_session.messages[
                                last_user_message_index:
                            ]
                        ]
                    ),
                }
            )

            await self._process_tool_calls(ai_message_model, response.tool_calls)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            await self.queue.put({"type": "ERROR", "message": str(e)})

    async def _process_tool_calls(
        self,
        ai_message: MessageModel,
        tool_calls: list[ToolCall] | None,
    ):
        if not tool_calls:
            return

        tasks = [
            tool_registry.invoke_tool(tool_call=tc, user=self.user) for tc in tool_calls
        ]
        responses: list[ToolResult] = list(await asyncio.gather(*tasks))
        last_tool_response = None
        for response in responses:
            nm = await chat_repository.add_message(
                user_id=self.chat_session.info.user_id,
                session_id=self.chat_session.info.id,
                message=NewMessage(
                    role="tool",
                    token_count=0,
                    content=response.content,
                    status=MessageStatus.COMPLETED,
                    tool_call_id=response.tool_call_id,
                    parent_message_id=ai_message.id,
                ),
                session=self.session,
            )
            last_tool_response = nm
            self.chat_session.messages.append(MessageModel.model_validate(nm))

        update = await chat_repository.update_message(
            user_id=self.chat_session.info.user_id,
            session_id=self.chat_session.info.id,
            message_id=ai_message.id,
            session=self.session,
            payload=UpdateMessage(
                status=MessageStatus.COMPLETED,
                active_child_id=last_tool_response.id,  # type: ignore
            ),
        )
        ai_message.active_child_id = update.active_child_id
        await self._process_messages(processing_tools=True)

    async def process_queue(self):
        seen_start = False
        while True:
            msg = await self.queue.get()

            if msg["type"] == "STREAM_START":
                seen_start = True
            elif msg["type"] == "ERROR":
                raise Exception(msg["message"])
            elif msg["type"] == "SKIP":
                break
            elif not seen_start:
                await self.websocket.send_json({"type": "STREAM_START"})
                seen_start = True

            await self.websocket.send_json(msg)
            if msg["type"] == "STREAM_END":
                break

    async def open(self):
        try:
            await self.websocket.accept()
            if self.queue.qsize() > 0:
                await self.process_queue()

            asyncio.create_task(self._generate_title())
            while True:
                asyncio.create_task(self._process_messages())
                await self.process_queue()

                raw_data = await self.websocket.receive_text()
                message_data = json.loads(raw_data)
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
                    ),
                    session=self.session,
                )

                self.chat_session.messages.append(
                    MessageModel.model_validate(user_message)
                )

        except WebSocketDisconnect:
            print("Chat stream disconnected for session")
        except asyncio.CancelledError:
            print("Shutting down WebSocket listener...")
            await self.websocket.send_json({"type": "CANCEL", "message": "canceled"})
            await self.websocket.close()
            raise
        except Exception as e:
            await self.websocket.send_json({"type": "ERROR", "message": str(e)})
            await self.websocket.close()

    async def generate_response(
        self,
        messages: list[LLMMessage],
    ) -> LLMFinalResponse:
        start_time = time.perf_counter()
        client = await self._get_client()
        response = client.chat(messages=messages)
        thinking = ""
        last_event: LLMEvent = LLMEvent.empty()
        tool_calls: list[ToolCall] = []

        async for event in response:
            last_event = event

            if event.tool_calls:
                tool_calls.extend(
                    [
                        ToolCall.model_validate(tc) if isinstance(tc, dict) else tc
                        for tc in event.tool_calls
                    ]
                )

            if event.type == LLMEventType.THINKING_COMPLETE:
                thinking = cast(str, event.content)

            await self.queue.put(event.to_dict())

        end_time = time.perf_counter()
        token_count = last_event.total_tokens or 0
        return LLMFinalResponse(
            thinking=thinking,
            event=last_event,
            total_tokens=token_count,
            tool_calls=tool_calls,
            tokens_per_second=(token_count / (end_time - start_time)),
        )
