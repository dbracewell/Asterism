"""Connection-independent, bounded in-process chat generation jobs.

A chat WebSocket is only a subscriber/command transport. The job owns generation
so a transient disconnect cannot cancel it; the manager owns retirement once a
job is idle and has no attached controllers.
"""

from __future__ import annotations

import asyncio
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Protocol

from asterism.core import config
from asterism.core.exceptions import CodedException
from asterism.domains.chat.message_queue import discard_message_queue

from .capacity import ChatCapacityError, ChatCapacityLimits


class ChatJobRuntime(Protocol):
    pending_approvals: dict[str, asyncio.Future[bool]]

    async def cancel_active_generation(self) -> None: ...
    async def generate_chat_title(self) -> None: ...


@dataclass
class ChatJob:
    orchestrator: ChatJobRuntime
    user_id: str
    chat_id: uuid.UUID
    _work_reserved: bool = field(default=False, repr=False)
    _watched_approvals: set[asyncio.Future] = field(default_factory=set, repr=False)
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
        def completed(task: asyncio.Task[None]) -> None:
            # Detached work may have no controller waiting on its result.
            if not task.cancelled():
                task.exception()
            if self._state_changed:
                self._state_changed()

        task.add_done_callback(completed)
        return task

    def start(self, operation: Awaitable[None]) -> asyncio.Task[None]:
        if self.retired:
            operation.close()  # pyright: ignore[reportAttributeAccessIssue]
            raise RuntimeError("This chat job has been retired")
        if self.manager and self.manager.chat_is_changing(self):
            operation.close()  # pyright: ignore[reportAttributeAccessIssue]
            raise CodedException(409, "Chat membership is changing; retry the turn")
        if self.is_active:
            operation.close()  # pyright: ignore[reportAttributeAccessIssue]
            raise RuntimeError("A generation is already active for this chat")

        try:
            if self.manager:
                self.manager.acquire_work(self)
        except BaseException:
            operation.close()  # pyright: ignore[reportAttributeAccessIssue]
            raise
        started = False

        async def run() -> None:
            nonlocal started
            started = True
            try:
                await operation
            except asyncio.CancelledError:
                # Cancellation is explicit and persists a terminal partial turn.
                await self.orchestrator.cancel_active_generation()

        self.task = self._watch(asyncio.create_task(run()))

        def close_unstarted(task):
            if not started:
                operation.close()  # pyright: ignore[reportAttributeAccessIssue]

        self.task.add_done_callback(close_unstarted)
        return self.task

    def start_title_generation(self) -> asyncio.Task[None]:
        if self.retired:
            raise RuntimeError("This chat job has been retired")
        if self.title_task is None:
            if self.manager:
                self.manager.acquire_work(self)
            self.title_task = self._watch(asyncio.create_task(self.orchestrator.generate_chat_title()))
        return self.title_task

    def cancel(self) -> bool:
        if not self.is_active:
            return False
        self.task.cancel()  # pyright: ignore[reportOptionalMemberAccess]
        return True

    async def cancel_and_wait(self) -> None:
        tasks = [task for task in (self.task, self.title_task) if task is not None and not task.done()]
        for task in tasks:
            task.cancel()
        for future in list(getattr(self.orchestrator, "pending_approvals", {}).values()):
            if not future.done():
                future.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


@dataclass(eq=False)
class ControllerAdmission:
    manager: ChatJobManager
    user_id: str
    job: ChatJob | None = None
    released: bool = False

    def release(self) -> None:
        self.manager.release_controller(self)


class ChatJobManager:
    """Manages the lifecycle of chat jobs, including creation, attachment, detachment, and retirement."""

    def __init__(self, limits: ChatCapacityLimits | None = None) -> None:
        self.limits = limits or ChatCapacityLimits(
            config.max_active_chat_jobs,
            config.max_active_chat_jobs_per_user,
            config.max_chat_controllers,
            config.max_chat_controllers_per_user,
        )
        self._work_count = 0
        self._work_by_user: dict[str, int] = {}
        self._admissions: set[ControllerAdmission] = set()
        self._controllers_by_user: dict[str, int] = {}
        self._jobs: dict[uuid.UUID, ChatJob] = {}
        self._retirement_tasks: set[asyncio.Task[None]] = set()
        self._shutting_down = False
        self._membership_changes: set[uuid.UUID] = set()

    def chat_is_changing(self, job: ChatJob) -> bool:
        return any(self._jobs.get(chat_id) is job for chat_id in self._membership_changes)

    @contextmanager
    def guard_idle_change(self, chat_id: uuid.UUID):
        """Serialize moves against process-local starts through transaction completion."""
        job = self._jobs.get(chat_id)
        if chat_id in self._membership_changes or (job and (job.is_active or job.has_pending_approval)):
            raise CodedException(409, "Cannot change a chat while a run is active or another change is in progress")
        self._membership_changes.add(chat_id)
        try:
            yield
        finally:
            self._membership_changes.discard(chat_id)

    @property
    def count(self) -> int:
        return len(self._jobs)

    def get_or_create(self, chat_id: uuid.UUID, orchestrator: ChatJobRuntime, *, user_id: str) -> ChatJob:
        if self._shutting_down:
            raise ChatCapacityError("Chat service is shutting down. Retry shortly.")
        # There is no await between lookup and insertion, so this is atomic on
        # the asyncio event loop. Later controllers attach to this runtime.
        job = self._jobs.get(chat_id)
        if job is None:
            job = ChatJob(orchestrator=orchestrator, user_id=user_id, chat_id=chat_id, manager=self)
            job._state_changed = lambda: self._job_state_changed(chat_id, job)
            self._jobs[chat_id] = job
        elif job.user_id != user_id:
            raise CodedException(404, "Chat runtime not found")
        return job

    @property
    def active_count(self) -> int:
        return self._work_count

    @property
    def controller_count(self) -> int:
        return len(self._admissions)

    def admit_controller(self, user_id: str) -> ControllerAdmission:
        if self._shutting_down:
            raise ChatCapacityError("Chat service is shutting down. Retry shortly.")
        if (
            len(self._admissions) >= self.limits.controllers
            or self._controllers_by_user.get(user_id, 0) >= self.limits.controllers_per_user
        ):
            raise ChatCapacityError("Chat connection capacity is full. Close an unused chat connection and retry.")
        admission = ControllerAdmission(self, user_id)
        self._admissions.add(admission)
        self._controllers_by_user[user_id] = self._controllers_by_user.get(user_id, 0) + 1
        return admission

    def release_controller(self, admission: ControllerAdmission) -> None:
        if admission not in self._admissions:
            return
        self._admissions.remove(admission)
        admission.released = True
        remaining = self._controllers_by_user[admission.user_id] - 1
        if remaining:
            self._controllers_by_user[admission.user_id] = remaining
        else:
            self._controllers_by_user.pop(admission.user_id)
        if admission.job is not None:
            admission.job.controllers -= 1

    def acquire_work(self, job: ChatJob) -> None:
        if self._shutting_down:
            raise ChatCapacityError("Chat service is shutting down. Retry shortly.")
        if self._jobs.get(job.chat_id) is not job or job.retired:
            raise RuntimeError("This chat job is no longer available")
        if job._work_reserved:
            return
        if (
            self._work_count >= self.limits.active_jobs
            or self._work_by_user.get(job.user_id, 0) >= self.limits.active_jobs_per_user
        ):
            raise ChatCapacityError()
        job._work_reserved = True
        self._work_count += 1
        self._work_by_user[job.user_id] = self._work_by_user.get(job.user_id, 0) + 1

    def _release_work(self, job: ChatJob) -> None:
        if not job._work_reserved:
            return
        job._work_reserved = False
        self._work_count -= 1
        remaining = self._work_by_user[job.user_id] - 1
        if remaining:
            self._work_by_user[job.user_id] = remaining
        else:
            self._work_by_user.pop(job.user_id)

    def _job_state_changed(self, chat_id: uuid.UUID, job: ChatJob) -> None:
        if self._jobs.get(chat_id) is not job:
            return
        if job.is_idle:
            self._release_work(job)
            if not job.controllers:
                self._schedule_retirement(chat_id, job)
        else:
            for future in getattr(job.orchestrator, "pending_approvals", {}).values():
                if not future.done() and future not in job._watched_approvals:
                    job._watched_approvals.add(future)

                    def done(future):
                        job._watched_approvals.discard(future)
                        self._job_state_changed(chat_id, job)

                    future.add_done_callback(done)

    def attach(self, chat_id: uuid.UUID, job: ChatJob, admission: ControllerAdmission) -> None:
        if self._jobs.get(chat_id) is not job or job.retired:
            raise RuntimeError("This chat job is no longer available")
        if admission not in self._admissions or admission.user_id != job.user_id or admission.job is not None:
            raise RuntimeError("Invalid chat controller admission")
        admission.job = job
        job.controllers += 1

    async def detach(self, chat_id: uuid.UUID, job: ChatJob, admission: ControllerAdmission) -> None:
        admission.release()
        await self.retire_if_idle(chat_id, job)

    def _schedule_retirement(self, chat_id: uuid.UUID, job: ChatJob) -> None:
        if self._jobs.get(chat_id) is not job:
            return
        task = asyncio.create_task(self.retire_if_idle(chat_id, job))
        self._retirement_tasks.add(task)  # pyright: ignore[reportArgumentType]
        task.add_done_callback(self._retirement_tasks.discard)

    async def retire_if_idle(self, chat_id: uuid.UUID, job: ChatJob) -> bool:
        if self._jobs.get(chat_id) is not job or job.controllers or not job.is_idle:
            return False
        self._release_work(job)
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
        try:
            await job.cancel_and_wait()
        finally:
            self._release_work(job)
            discard_message_queue(chat_id)

    async def shutdown(self) -> None:
        self._shutting_down = True
        jobs = list(self._jobs.items())
        self._jobs.clear()
        for _, job in jobs:
            job.retired = True
        await asyncio.gather(*(job.cancel_and_wait() for _, job in jobs), return_exceptions=True)
        for chat_id, job in jobs:
            self._release_work(job)
            discard_message_queue(chat_id)
        for admission in list(self._admissions):
            admission.release()
        pending = list(self._retirement_tasks)
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)


chat_jobs = ChatJobManager()
