"""Connection-independent, bounded in-process chat generation jobs.

A chat WebSocket is only a subscriber/command transport. The job owns generation
so a transient disconnect cannot cancel it; the manager owns retirement once a
job is idle and has no attached controllers.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from asterism.domains.chat.message_queue import discard_message_queue
from asterism.domains.chat.orchestrator import ChatOrchestrator


@dataclass
class ChatJob:
    orchestrator: ChatOrchestrator
    task: asyncio.Task[None] | None = None
    title_task: asyncio.Task[None] | None = None
    controllers: int = 0
    retired: bool = False
    manager: ChatJobManager | None = field(default=None, repr=False)
    _state_changed: Callable[[], None] | None = field(default=None, repr=False)

    @property
    def is_active(self) -> bool:
        return self.task is not None and not self.task.done()

    @property
    def has_pending_approval(self) -> bool:
        approvals = getattr(self.orchestrator, "pending_approvals", {})
        return any(not future.done() for future in approvals.values())

    @property
    def is_idle(self) -> bool:
        title_active = self.title_task is not None and not self.title_task.done()
        return not self.is_active and not title_active and not self.has_pending_approval

    def _watch(self, task: asyncio.Task[None]) -> asyncio.Task[None]:
        task.add_done_callback(lambda _: self._state_changed and self._state_changed())
        return task

    def start(self, operation: Awaitable[None]) -> asyncio.Task[None]:
        if self.retired:
            operation.close()
            raise RuntimeError("This chat job has been retired")
        if self.is_active:
            operation.close()
            raise RuntimeError("A generation is already active for this chat")

        async def run() -> None:
            try:
                await operation
            except asyncio.CancelledError:
                # Cancellation is explicit and persists a terminal partial turn.
                await self.orchestrator.cancel_active_generation()

        self.task = self._watch(asyncio.create_task(run()))
        return self.task

    def start_title_generation(self) -> asyncio.Task[None]:
        if self.retired:
            raise RuntimeError("This chat job has been retired")
        if self.title_task is None:
            self.title_task = self._watch(asyncio.create_task(self.orchestrator.generate_chat_title()))
        return self.title_task

    def cancel(self) -> bool:
        if not self.is_active:
            return False
        self.task.cancel()
        return True

    async def cancel_and_wait(self) -> None:
        tasks = [task for task in (self.task, self.title_task) if task is not None and not task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


class ChatJobManager:
    def __init__(self) -> None:
        self._jobs: dict[uuid.UUID, ChatJob] = {}
        self._retirement_tasks: set[asyncio.Task[None]] = set()
        self._shutting_down = False

    @property
    def count(self) -> int:
        return len(self._jobs)

    def get_or_create(self, chat_id: uuid.UUID, orchestrator: ChatOrchestrator) -> ChatJob:
        if self._shutting_down:
            raise RuntimeError("Chat jobs are shutting down")
        # There is no await between lookup and insertion, so this is atomic on
        # the asyncio event loop. Later controllers attach to this runtime.
        job = self._jobs.get(chat_id)
        if job is None:
            job = ChatJob(orchestrator=orchestrator, manager=self)
            job._state_changed = lambda: self._schedule_retirement(chat_id, job)
            self._jobs[chat_id] = job
        return job

    def attach(self, chat_id: uuid.UUID, job: ChatJob) -> None:
        if self._jobs.get(chat_id) is not job or job.retired:
            raise RuntimeError("This chat job is no longer available")
        job.controllers += 1

    async def detach(self, chat_id: uuid.UUID, job: ChatJob) -> None:
        if self._jobs.get(chat_id) is not job:
            return
        job.controllers = max(0, job.controllers - 1)
        await self.retire_if_idle(chat_id, job)

    def _schedule_retirement(self, chat_id: uuid.UUID, job: ChatJob) -> None:
        if self._jobs.get(chat_id) is not job:
            return
        task = asyncio.create_task(self.retire_if_idle(chat_id, job))
        self._retirement_tasks.add(task)
        task.add_done_callback(self._retirement_tasks.discard)

    async def retire_if_idle(self, chat_id: uuid.UUID, job: ChatJob) -> bool:
        if self._jobs.get(chat_id) is not job or job.controllers or not job.is_idle:
            return False
        job.retired = True
        self._jobs.pop(chat_id, None)
        discard_message_queue(chat_id)
        return True

    async def retire(self, chat_id: uuid.UUID) -> None:
        """Cancel a chat before deletion, then make its runtime unreachable."""
        job = self._jobs.pop(chat_id, None)
        if job is None:
            discard_message_queue(chat_id)
            return
        job.retired = True
        await job.cancel_and_wait()
        discard_message_queue(chat_id)

    async def shutdown(self) -> None:
        self._shutting_down = True
        jobs = list(self._jobs.items())
        self._jobs.clear()
        for _, job in jobs:
            job.retired = True
        await asyncio.gather(*(job.cancel_and_wait() for _, job in jobs), return_exceptions=True)
        for chat_id, _ in jobs:
            discard_message_queue(chat_id)
        pending = list(self._retirement_tasks)
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)


chat_jobs = ChatJobManager()
