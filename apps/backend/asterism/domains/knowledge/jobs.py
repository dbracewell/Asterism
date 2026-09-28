"""Lifecycle-owned bounded background file-artifact processing jobs."""

import asyncio
import uuid

from sqlalchemy import select, update

from asterism.db.database import get_async_db_session
from asterism.domains.files.models import UserFileModel

from .ingestion import ingest_file_artifact
from .models import FileKnowledgeArtifactModel, FileKnowledgeArtifactStatus


class KnowledgeIngestionJobs:
    def __init__(self, max_concurrency: int) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def enqueue(self, *, user_id: str, file_id: uuid.UUID, artifact_id: uuid.UUID) -> bool:
        """Schedule at most one job for a particular immutable generation."""
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
        try:
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
                    from .runtime import embedding_provider, vector_store

                    await ingest_file_artifact(
                        artifact=artifact,
                        file=file,
                        session=session,
                        embedding_provider=embedding_provider,
                        vector_store=vector_store,
                    )
        except Exception:
            # Restart recovery and explicit retry will process the persisted
            # pending artifact; never leak task exceptions from uploads.
            return

    async def recover_interrupted(self) -> None:
        """Make interrupted work explicitly retryable after a restart."""
        async with get_async_db_session() as session:
            await session.execute(
                update(FileKnowledgeArtifactModel)
                .where(FileKnowledgeArtifactModel.status == FileKnowledgeArtifactStatus.PROCESSING)
                .values(
                    status=FileKnowledgeArtifactStatus.PENDING,
                    error_code="interrupted",
                    error_reason="Processing interrupted by restart; retry queued",
                    started_at=None,
                )
            )
            await session.commit()

    async def shutdown(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        await self.recover_interrupted()
