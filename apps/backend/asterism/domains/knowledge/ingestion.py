"""Bounded, idempotent processing of canonical file-artifact generations."""

import hashlib
import logging
from collections.abc import Sequence

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core import config
from asterism.db.mixins import get_unix_timestamp
from asterism.domains.files.models import FileContentStatus, FileKind, UserFileModel
from asterism.domains.files.service import ensure_file_processed, get_file_store

from .audit import record_knowledge_audit
from .embeddings import EmbeddingProvider, EmbeddingProviderError
from .models import (
    FileKnowledgeArtifactModel,
    FileKnowledgeArtifactStatus,
    KnowledgeCaptionConfigurationModel,
    KnowledgeCaptionMode,
    KnowledgeCaptionStatus,
)
from .vector_store import VectorChunk, VectorStore

logger = logging.getLogger(__name__)


class KnowledgeIngestionError(RuntimeError):
    """A document could not safely be made searchable."""


def chunk_text(text: str) -> list[str]:
    """Produce bounded, deterministic character chunks without splitting an empty document."""
    source = text.strip()
    if not source:
        raise KnowledgeIngestionError("The document contains no indexable text")
    size = config.knowledge_chunk_size_chars
    step = size - config.knowledge_chunk_overlap_chars
    chunks = [source[offset : offset + size].strip() for offset in range(0, len(source), step)]
    chunks = [chunk for chunk in chunks if chunk]
    if len(chunks) > config.max_knowledge_chunks_per_document:
        raise KnowledgeIngestionError("The document exceeds the configured knowledge chunk limit")
    return chunks


def _artifact_chunk_id(artifact: FileKnowledgeArtifactModel, ordinal: int) -> str:
    source = f"{artifact.file_id}:{artifact.generation}:{ordinal}".encode()
    return hashlib.sha256(source).hexdigest()


async def ingest_file_artifact(
    *,
    artifact: FileKnowledgeArtifactModel,
    file: UserFileModel,
    session: AsyncSession,
    embedding_provider: EmbeddingProvider,
    vector_store: VectorStore,
) -> FileKnowledgeArtifactModel:
    """Build one file-owned generation and atomically make it current.

    Vector replacement happens before the relational promotion. A failure can
    therefore leave the previous ready generation searchable, but never marks
    partial new work current.
    """
    if artifact.status is FileKnowledgeArtifactStatus.READY:
        return artifact
    if artifact.status is FileKnowledgeArtifactStatus.CANCELED:
        return artifact
    artifact.status = FileKnowledgeArtifactStatus.PROCESSING
    artifact.error_code = None
    artifact.error_reason = None
    artifact.started_at = get_unix_timestamp()
    session.add(
        record_knowledge_audit(user_id=file.user_id, action="file.processing_started", file_id=file.id)
    )
    await session.commit()
    try:
        processed = await ensure_file_processed(file=file, session=session)
        if processed.content_status is not FileContentStatus.READY:
            raise KnowledgeIngestionError(processed.content_error or "The file could not be processed")
        if processed.kind is FileKind.IMAGE:
            path = get_file_store().open(processed.user_id, processed.filename)
            contents = [f"Image file: {processed.original_name}"]
            vectors = await embedding_provider.embed_image([path])
            visual_ready = True
        else:
            contents = chunk_text(processed.content_cache or "")
            vectors = await embedding_provider.embed_text(contents)
            visual_ready = False
        if len(vectors) != len(contents):
            raise KnowledgeIngestionError("The embedding provider returned an unexpected result count")
        chunks: Sequence[VectorChunk] = [
            VectorChunk(
                id=_artifact_chunk_id(artifact, ordinal),
                user_id=processed.user_id,
                file_id=str(processed.id),
                artifact_generation=artifact.generation,
                chunk_ordinal=ordinal,
                content=content,
                vector=vector,
            )
            for ordinal, (content, vector) in enumerate(zip(contents, vectors, strict=True))
        ]
        await vector_store.delete_file_generation(
            user_id=processed.user_id,
            file_id=str(processed.id),
            artifact_generation=artifact.generation,
        )
        await vector_store.add(chunks)
        current_status = await session.scalar(
            select(FileKnowledgeArtifactModel.status).where(
                FileKnowledgeArtifactModel.id == artifact.id,
                FileKnowledgeArtifactModel.file_id == processed.id,
            )
        )
        if current_status is None:
            raise KnowledgeIngestionError("The file was deleted during processing")
        if current_status is FileKnowledgeArtifactStatus.CANCELED:
            await vector_store.delete_file_generation(
                user_id=processed.user_id,
                file_id=str(processed.id),
                artifact_generation=artifact.generation,
            )
            await session.refresh(artifact)
            return artifact
    except Exception as error:
        try:
            await vector_store.delete_file_generation(
                user_id=file.user_id, file_id=str(file.id), artifact_generation=artifact.generation
            )
        except Exception:
            logger.exception("Could not remove partial file knowledge vectors", extra={"file_id": str(file.id)})
        artifact.status = FileKnowledgeArtifactStatus.FAILED
        artifact.error_code = "processing_failed"
        artifact.error_reason = (
            str(error)[:512]
            if isinstance(error, (KnowledgeIngestionError, EmbeddingProviderError))
            else "Knowledge processing failed; check the server logs"
        )
        artifact.completed_at = None
        session.add(record_knowledge_audit(user_id=file.user_id, action="file.processing_failed", file_id=file.id))
        await session.commit()
        return artifact

    await session.execute(
        update(FileKnowledgeArtifactModel)
        .where(FileKnowledgeArtifactModel.file_id == file.id, FileKnowledgeArtifactModel.is_current.is_(True))
        .values(is_current=False)
    )
    artifact.status = FileKnowledgeArtifactStatus.READY
    artifact.is_current = True
    artifact.extracted_content = processed.content_cache if processed.kind is not FileKind.IMAGE else None
    artifact.chunk_count = len(chunks)
    artifact.text_embeddings_ready = processed.kind is not FileKind.IMAGE
    artifact.visual_embedding_ready = visual_ready
    artifact.completed_at = get_unix_timestamp()
    caption_requested = False
    if processed.kind is FileKind.IMAGE:
        caption_configuration = await session.get(KnowledgeCaptionConfigurationModel, 1)
        caption_requested = (
            caption_configuration is not None and caption_configuration.mode is not KnowledgeCaptionMode.DISABLED
        )
        artifact.caption_status = KnowledgeCaptionStatus.PENDING if caption_requested else None
    session.add(record_knowledge_audit(user_id=file.user_id, action="file.processing_ready", file_id=file.id))
    await session.commit()
    if caption_requested:
        from .runtime import knowledge_caption_jobs

        knowledge_caption_jobs.enqueue(user_id=file.user_id, file_id=file.id, artifact_id=artifact.id)
    return artifact
