"""Owns the diffusion worker process from the server side (US-76.2).

One worker at a time. It starts on the first job, keeps the model loaded for
the next one, and stops after an idle period or when a different model or
device is needed. A cancelled job kills the worker (a diffusion step can't be
interrupted); the next job starts a fresh one.
"""

import asyncio
import multiprocessing
from dataclasses import dataclass
from multiprocessing.connection import Connection
from multiprocessing.process import BaseProcess
from typing import Any

from asterism.common.log import get_logger

from ..providers import ImageGenerationError
from ..schemas import ImageProgress
from .worker import worker_main

logger = get_logger("ImageWorker")

IDLE_SECONDS = 600.0
POLL_SECONDS = 0.2
OOM_MESSAGE = "The model ran out of memory. Choose a smaller model or image size, or close other GPU work."


@dataclass(frozen=True)
class WorkerKey:
    model_dir: str
    pipeline: str
    device: str
    mode: str
    dtype: str


@dataclass
class _Worker:
    key: WorkerKey
    process: BaseProcess
    conn: Connection
    loaded: bool = False


class LocalRuntime:
    def __init__(self, idle_seconds: float = IDLE_SECONDS):
        self.idle_seconds = idle_seconds
        self._worker: _Worker | None = None
        self._idle: asyncio.TimerHandle | None = None

    @property
    def running(self) -> WorkerKey | None:
        return self._worker.key if self._worker and self._worker.process.is_alive() else None

    def _start(self, key: WorkerKey) -> _Worker:
        context = multiprocessing.get_context("spawn")
        parent, child = context.Pipe()
        process = context.Process(
            target=worker_main,
            args=(child, key.model_dir, key.pipeline, key.device, key.mode, key.dtype),
            daemon=True,
            name="asterism-image-worker",
        )
        process.start()
        child.close()
        logger.info(f"Started image worker {process.pid} for {key.pipeline} on {key.device} ({key.mode})")
        return _Worker(key=key, process=process, conn=parent)

    def _kill(self) -> None:
        worker, self._worker = self._worker, None
        if self._idle is not None:
            self._idle.cancel()
            self._idle = None
        if worker is None:
            return
        try:
            if worker.process.is_alive():
                worker.conn.send(("stop",))
        except (OSError, ValueError):
            pass
        worker.process.join(timeout=2)
        if worker.process.is_alive():
            worker.process.kill()
            worker.process.join(timeout=2)
        worker.conn.close()
        logger.info(f"Stopped image worker {worker.process.pid}")

    async def stop(self) -> None:
        await asyncio.to_thread(self._kill)

    async def _receive(self, worker: _Worker) -> tuple[Any, ...]:
        while True:
            if await asyncio.to_thread(worker.conn.poll, POLL_SECONDS):
                try:
                    return worker.conn.recv()
                except EOFError:
                    pass
            if not worker.process.is_alive():
                code = worker.process.exitcode
                self._worker = None
                raise ImageGenerationError(
                    f"The image worker stopped unexpectedly (exit code {code}). It restarts on the next "
                    "request; if this repeats, choose a smaller model."
                )

    def _schedule_idle_stop(self) -> None:
        if self._idle is not None:
            self._idle.cancel()
        loop = asyncio.get_running_loop()
        self._idle = loop.call_later(self.idle_seconds, lambda: loop.create_task(self.stop()))

    async def generate(self, key: WorkerKey, job: dict[str, Any], progress) -> list[tuple[bytes, int]]:
        """Run one job, starting or swapping the worker as needed."""
        if self._idle is not None:
            self._idle.cancel()
            self._idle = None
        if self._worker is not None and (self._worker.key != key or not self._worker.process.is_alive()):
            await self.stop()
        if self._worker is None:
            self._worker = await asyncio.to_thread(self._start, key)
        worker = self._worker
        try:
            if not worker.loaded:
                await progress(ImageProgress(stage="loading"))
                message = await self._receive(worker)
                if message[0] == "error":
                    await self.stop()
                    raise ImageGenerationError(OOM_MESSAGE if message[1] == "oom" else str(message[2]))
                worker.loaded = True
            worker.conn.send(("generate", job))
            while True:
                message = await self._receive(worker)
                if message[0] == "progress":
                    await progress(ImageProgress(stage="running", step=message[1], total=message[2]))
                elif message[0] == "result":
                    return message[1]
                elif message[0] == "error":
                    if message[1] == "oom":
                        # Free everything the failed job held.
                        await self.stop()
                        raise ImageGenerationError(OOM_MESSAGE)
                    raise ImageGenerationError(f"Image generation failed: {message[2]}")
        except asyncio.CancelledError:
            await asyncio.shield(self.stop())
            raise
        finally:
            if self._worker is worker:
                self._schedule_idle_stop()


runtime = LocalRuntime()
