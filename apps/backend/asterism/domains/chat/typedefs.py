import asyncio
import uuid
from asyncio.tasks import Task
from dataclasses import dataclass, field
from logging import Logger
from typing import Coroutine

from fastapi import WebSocket

from asterism.domains.agent.agent import Agent
from asterism.domains.chat.message_queue import MessageQueue, get_message_queue

from .schemas import (
    Chat,
    ChatInfo,
    Message,
)


@dataclass
class ChatState:
    websocket: WebSocket
    chat: Chat
    agent: Agent
    logger: Logger
    is_processing_messages: bool = False
    background_tasks: list[asyncio.Task] = field(default_factory=list)
    task_queue: list[Coroutine] = field(default_factory=list)

    @property
    def has_pending_tasks(self) -> bool:
        return len(self.task_queue) > 0

    def next_pending_task(self) -> Task:
        return asyncio.create_task(self.task_queue.pop(0))

    @property
    def chat_info(self) -> ChatInfo:
        return self.chat.info

    @property
    def chat_id(self) -> uuid.UUID:
        return self.chat.info.id

    @property
    def messages(self) -> list[Message]:
        return self.chat.messages

    @property
    def user_id(self) -> str:
        return self.chat.info.user_id

    def add_background_task(self, coroutine: Coroutine) -> None:
        self.background_tasks.append(asyncio.create_task(coroutine))

    def add_pending_task(self, coroutine: Coroutine) -> None:
        self.task_queue.append(coroutine)

    @property
    def queue(self) -> MessageQueue:
        return get_message_queue(self.chat.info.id)

    @property
    def is_processing(self) -> bool:
        return self.queue.qsize() > 0 or self.is_processing_messages
