"""Lifecycle-owned knowledge storage services."""

import uuid

from asterism.common.job_queue import JobManager
from asterism.common.log import get_logger
from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.domains.extraction.embedding import embedding_download_service, embedding_provider
from asterism.domains.extraction.ingestion import ingest
from asterism.domains.extraction.models import FileExtractionModel, FileKnowledgeArtifactStatus, KnowledgeCaptionStatus
from captioning import caption, captioning_download_service, local_caption_provider
from sqlalchemy import select, update
from vector_store import vector_store

logger = get_logger("KNOWLEDGE-RUNTIME")


job_manager = JobManager(
    max_concurrency=config.max_concurrent_extractions,
)


def start_file_ingestion_job(
    user_id: str,
    file_id: uuid.UUID,
    artifact_id: uuid.UUID,
):
    job_manager.enqueue(
        key=f"ingestion-{artifact_id}",
        runnable=ingest,
        user_id=user_id,
        file_id=file_id,
        artifact_id=artifact_id,
        on_caption_request=lambda artifact, file: job_manager.enqueue(
            key=f"caption-{user_id}:{file_id}:{artifact_id}",
            runnable=caption,
            artifact=artifact,
            file=file,
        ),
    )


async def recover_interrupted() -> None:
    """Make interrupted work explicitly retryable after a restart."""
    async with get_async_db_session() as session:
        await session.execute(
            update(FileExtractionModel)
            .where(FileExtractionModel.status == FileKnowledgeArtifactStatus.PROCESSING)
            .values(
                status=FileKnowledgeArtifactStatus.PENDING,
                error_code="interrupted",
                error_reason="Processing interrupted by restart; retry queued",
                started_at=None,
            ),
        )
        await session.execute(
            update(FileExtractionModel)
            .where(FileExtractionModel.caption_status == KnowledgeCaptionStatus.RUNNING)
            .values(caption_status=KnowledgeCaptionStatus.FAILED, caption_error_code="interrupted"),
        )
        await session.commit()


async def resume_ingestion_jobs() -> None:
    async with get_async_db_session() as session:
        artifacts = list(
            await session.scalars(
                select(FileExtractionModel).where(
                    FileExtractionModel.status == FileKnowledgeArtifactStatus.PENDING,
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
    # The download service verifies an existing local bundle during construction.
    # Restore that verified manifest hash into the provider after a process restart;
    # otherwise a valid downloaded bundle would incorrectly look unprovisioned.
    download_progress = captioning_download_service.progress()
    if download_progress.status == "ready" and captioning_download_service.on_bundle_ready:
        await captioning_download_service.on_bundle_ready(download_progress.bundle_sha256)

    await vector_store.initialize()
    await recover_interrupted()

    embedding_download_service.on_bundle_ready = lambda _: resume_ingestion_jobs()
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
