"""Lifecycle-owned knowledge storage services."""

import asyncio
import uuid

from sqlalchemy import select, update

from asterism.common.job_queue import JobManager
from asterism.common.log import get_logger
from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.domains.knowledge.embedding import embedding_download_service, embedding_provider
from asterism.domains.knowledge.ingestion import ingest
from asterism.domains.knowledge.models import (
    FileKnowledgeArtifactModel,
    FileKnowledgeExtractionModel,
    KnowledgeExtractionKind,
    KnowledgeExtractionStatus,
)

from .captioning import caption, captioning_download_service, local_caption_provider
from .vector_store import vector_store

logger = get_logger("KNOWLEDGE-RUNTIME")


job_manager = JobManager(
    max_concurrency=config.max_concurrent_knowledge_jobs,
)


def start_file_caption_job(user_id: str, file_id: uuid.UUID, artifact_id: uuid.UUID) -> bool:
    return job_manager.enqueue(
        key=f"caption-{artifact_id}",
        runnable=caption,
        user_id=user_id,
        file_id=file_id,
        artifact_id=artifact_id,
    )


def start_file_ingestion_job(user_id: str, file_id: uuid.UUID, artifact_id: uuid.UUID) -> bool:
    if not embedding_download_service.is_ready():
        # Persisted pending rows are resumed after provisioning succeeds.
        return False
    return job_manager.enqueue(
        key=f"ingestion-{artifact_id}",
        runnable=ingest,
        user_id=user_id,
        file_id=file_id,
        artifact_id=artifact_id,
        on_caption_request=start_file_caption_job,
    )


async def cancel_file_jobs(artifact_id: uuid.UUID) -> None:
    await job_manager.cancel_and_wait(f"ingestion-{artifact_id}")
    await job_manager.cancel_and_wait(f"caption-{artifact_id}")


async def recover_interrupted() -> None:
    """Make interrupted work explicitly retryable after a restart."""
    async with get_async_db_session() as session:
        await session.execute(
            update(FileKnowledgeArtifactModel)
            .where(FileKnowledgeArtifactModel.status == KnowledgeExtractionStatus.RUNNING)
            .values(
                status=KnowledgeExtractionStatus.PENDING,
                error_code="interrupted",
                error_reason="Processing interrupted by restart; retry queued",
                started_at=None,
            ),
        )
        await session.execute(
            update(FileKnowledgeExtractionModel)
            .where(
                FileKnowledgeExtractionModel.status == KnowledgeExtractionStatus.RUNNING,
                FileKnowledgeExtractionModel.kind == KnowledgeExtractionKind.CAPTIONING,
            )
            .values(
                status=KnowledgeExtractionStatus.FAILED,
                error_code="interrupted",
                error_reason="Captioning interrupted by restart; retry queued",
            ),
        )
        await session.commit()


async def resume_ingestion_jobs() -> None:
    async with get_async_db_session() as session:
        artifacts = list(
            await session.scalars(
                select(FileKnowledgeArtifactModel).where(
                    FileKnowledgeArtifactModel.status == KnowledgeExtractionStatus.PENDING,
                ),
            ),
        )
        for artifact in artifacts:
            start_file_ingestion_job(
                user_id=artifact.user_id,
                file_id=artifact.file_id,
                artifact_id=artifact.id,
            )


async def initialize_knowledge_runtime() -> None:
    """Create/open LanceDB and make interrupted jobs explicitly retryable."""
    await vector_store.initialize()
    await recover_interrupted()

    if config.skip_knowledge_model_provisioning:
        logger.info("Knowledge model provisioning disabled by runtime configuration")
        return

    embedding_download_service.on_bundle_ready = lambda _: resume_ingestion_jobs()
    await asyncio.to_thread(embedding_download_service._ensure_checked)
    if embedding_download_service.is_ready():
        await resume_ingestion_jobs()
    else:
        await embedding_download_service.start_download()


async def shutdown_knowledge_runtime() -> None:
    await embedding_download_service.shutdown()
    await captioning_download_service.shutdown()
    await job_manager.shutdown()
    await local_caption_provider.close()
    await embedding_provider.close()
    await vector_store.close()
