"""Bounded background caption jobs owned by file-artifact generations."""

import asyncio
import hashlib
import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy import select, update

from asterism.db.database import get_async_db_session
from asterism.db.mixins import get_unix_timestamp
from asterism.domains.files.models import UserFileModel

from .captioning import CaptionErrorCode, CaptionResult
from .models import (
    FileKnowledgeArtifactModel,
    KnowledgeCaptionMode,
    KnowledgeCaptionStatus,
)
from .vector_store import VectorChunk

CaptionRunner = Callable[[FileKnowledgeArtifactModel, UserFileModel], Awaitable[CaptionResult]]


class KnowledgeCaptionJobs:
    def __init__(self, runner: CaptionRunner, max_concurrency: int = 1) -> None:
        self._runner = runner
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def enqueue(self, *, user_id: str, file_id: uuid.UUID, artifact_id: uuid.UUID) -> bool:
        key = str(artifact_id)
        if key in self._tasks:
            return False
        task = asyncio.create_task(self._run(user_id=user_id, file_id=file_id, artifact_id=artifact_id))
        self._tasks[key] = task
        task.add_done_callback(lambda _: self._tasks.pop(key, None))
        return True

    def cancel(self, artifact_id: str) -> bool:
        task = self._tasks.get(artifact_id)
        if task is None:
            return False
        task.cancel()
        return True

    async def _run(self, *, user_id: str, file_id: uuid.UUID, artifact_id: uuid.UUID) -> None:
        async with self._semaphore:
            async with get_async_db_session() as session:
                artifact = await session.scalar(
                    select(FileKnowledgeArtifactModel).where(
                        FileKnowledgeArtifactModel.id == artifact_id,
                        FileKnowledgeArtifactModel.user_id == user_id,
                        FileKnowledgeArtifactModel.file_id == file_id,
                    )
                )
                file = await session.scalar(
                    select(UserFileModel).where(UserFileModel.id == file_id, UserFileModel.user_id == user_id)
                )
                if artifact is None or file is None:
                    return
                artifact.caption_status = KnowledgeCaptionStatus.RUNNING
                await session.commit()
                try:
                    result = await self._runner(artifact, file)
                except Exception:
                    artifact.caption_status = KnowledgeCaptionStatus.FAILED
                    artifact.caption_error_code = CaptionErrorCode.PROVIDER_FAILURE.value
                    artifact.caption_error_reason = "Caption generation failed"
                else:
                    from .runtime import embedding_provider, vector_store

                    caption_vector = await embedding_provider.embed_text([result.text])
                    if len(caption_vector) != 1:
                        raise RuntimeError("Caption embedding provider returned an unexpected result")
                    chunk_id = hashlib.sha256(f"{artifact.file_id}:{artifact.generation}:caption".encode()).hexdigest()
                    await vector_store.delete_chunk(user_id=user_id, chunk_id=chunk_id)
                    await vector_store.add(
                        [
                            VectorChunk(
                                id=chunk_id,
                                user_id=user_id,
                                file_id=str(file_id),
                                artifact_generation=artifact.generation,
                                chunk_ordinal=artifact.chunk_count,
                                content=result.text,
                                vector=caption_vector[0],
                            )
                        ]
                    )
                    artifact.caption_status = KnowledgeCaptionStatus.DRAFT
                    artifact.caption_source = KnowledgeCaptionMode(result.source.value)
                    artifact.caption_model = result.model[:512]
                    artifact.caption_text = result.text
                    artifact.caption_error_code = None
                    artifact.caption_error_reason = None
                artifact.completed_at = get_unix_timestamp()
                await session.commit()

    async def recover_interrupted(self) -> None:
        async with get_async_db_session() as session:
            await session.execute(
                update(FileKnowledgeArtifactModel)
                .where(FileKnowledgeArtifactModel.caption_status == KnowledgeCaptionStatus.RUNNING)
                .values(caption_status=KnowledgeCaptionStatus.FAILED, caption_error_code="interrupted")
            )
            await session.commit()

    async def shutdown(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        self._tasks.clear()
