"""Lifecycle-owned bounded background knowledge ingestion jobs."""

import asyncio
import uuid

from sqlalchemy import update

from asterism.db.database import get_async_db_session

from .ingestion import ingest_document, load_document_for_ingestion
from .models import KnowledgeDocumentModel, KnowledgeDocumentStatus


class KnowledgeIngestionJobs:
    def __init__(self, max_concurrency: int) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def enqueue(self, *, user_id: str, knowledge_base_id: uuid.UUID, document_id: uuid.UUID) -> bool:
        """Schedule at most one job per document. Returns False when already queued."""
        document_key = str(document_id)
        if document_key in self._tasks:
            return False
        task = asyncio.create_task(self._run(user_id, knowledge_base_id, document_id))
        self._tasks[document_key] = task
        task.add_done_callback(lambda _: self._tasks.pop(document_key, None))
        return True

    def cancel(self, document_id: str) -> bool:
        task = self._tasks.get(document_id)
        if task is None:
            return False
        task.cancel()
        return True

    async def _run(self, user_id: str, knowledge_base_id: uuid.UUID, document_id: uuid.UUID) -> None:
        async with self._semaphore:
            async with get_async_db_session() as session:
                loaded = await load_document_for_ingestion(
                    user_id=user_id,
                    knowledge_base_id=knowledge_base_id,
                    document_id=document_id,
                    session=session,
                )
                if loaded is None:
                    return
                document, file = loaded
                # Kept local to avoid a runtime ↔ jobs import cycle.
                from .runtime import embedding_provider, vector_store

                await ingest_document(
                    document=document,
                    file=file,
                    session=session,
                    embedding_provider=embedding_provider,
                    vector_store=vector_store,
                )

    async def recover_interrupted(self) -> None:
        """Make stale in-progress work explicitly retryable after a restart."""
        async with get_async_db_session() as session:
            await session.execute(
                update(KnowledgeDocumentModel)
                .where(KnowledgeDocumentModel.status == KnowledgeDocumentStatus.INDEXING)
                .values(
                    status=KnowledgeDocumentStatus.FAILED,
                    error="Indexing interrupted by restart; retry indexing",
                    indexed_at=None,
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
        # Work may have been cancelled after its indexing transition was
        # committed. Persist a retryable status rather than leaving it stuck.
        await self.recover_interrupted()
