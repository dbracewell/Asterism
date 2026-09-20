"""Connection-independent in-process chat generation jobs.

A chat WebSocket is only a subscriber/command transport.  The job owns the
orchestrator task so a disconnect cannot cancel a provider request.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from typing import Awaitable

from asterism.domains.chat.orchestrator import ChatOrchestrator


@dataclass
class ChatJob:
    orchestrator: ChatOrchestrator
    task: asyncio.Task[None] | None = None
    title_task: asyncio.Task[None] | None = None

    @property
    def is_active(self) -> bool:
        return self.task is not None and not self.task.done()

    def start(self, operation: Awaitable[None]) -> asyncio.Task[None]:
        if self.is_active:
            raise RuntimeError("A generation is already active for this chat")

        async def run() -> None:
            try:
                await operation
            except asyncio.CancelledError:
                # Cancellation is an expected explicit user action.  Do not
                # propagate it into a WebSocket controller that merely awaits
                # this independently owned job.
                await self.orchestrator.cancel_active_generation()

        self.task = asyncio.create_task(run())
        return self.task

    def start_title_generation(self) -> asyncio.Task[None]:
        if self.title_task is None:
            self.title_task = asyncio.create_task(self.orchestrator.generate_chat_title())
        return self.title_task

    def cancel(self) -> bool:
        if not self.is_active:
            return False
        self.task.cancel()  # type: ignore
        return True


class ChatJobManager:
    def __init__(self) -> None:
        self._jobs: dict[uuid.UUID, ChatJob] = {}

    def get_or_create(self, chat_id: uuid.UUID, orchestrator: ChatOrchestrator) -> ChatJob:
        # There is no await between lookup and insertion, so this is atomic on
        # the event loop. The first connection owns the durable chat runtime;
        # later connections attach to it rather than creating another agent.
        job = self._jobs.get(chat_id)
        if job is None:
            job = ChatJob(orchestrator=orchestrator)
            self._jobs[chat_id] = job
        return job


chat_jobs = ChatJobManager()
