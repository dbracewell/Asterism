"""Bounded, idempotent processing of canonical file-artifact generations."""

import hashlib
import logging
import uuid
from collections.abc import Callable, Sequence

from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.db.mixins import get_unix_timestamp
from asterism.domains.files.models import FileContentStatus, FileKind, UserFileModel
from asterism.domains.files.service import ensure_file_processed, get_file_store
from asterism.domains.knowledge_base.service import get_captioning_configuration
from embedding import EmbeddingProviderError, embedding_provider
from models import (
    FileExtractionModel,
    FileKnowledgeArtifactStatus,
    KnowledgeCaptionMode,
    KnowledgeCaptionStatus,
)
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from vector_store import VectorChunk, vector_store

logger = logging.getLogger(__name__)


class KnowledgeIngestionError(RuntimeError):
    """A document could not safely be made searchable."""


class ExtractionError(RuntimeError):
    pass


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


def _artifact_chunk_id(artifact: FileExtractionModel, ordinal: int) -> str:
    source = f"{artifact.file_id}:{artifact.generation}:{ordinal}".encode()
    return hashlib.sha256(source).hexdigest()


async def embed_file(processed: UserFileModel) -> tuple[list[list[float]], list[str], bool]:
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

    return vectors, contents, visual_ready


async def ingest(
    user_id: str,
    file_id: uuid.UUID,
    artifact_id: uuid.UUID,
    on_caption_request: Callable[[str, uuid.UUID, uuid.UUID], None],
):
    try:
        async with get_async_db_session() as session:
            artifact = await session.scalar(
                select(FileExtractionModel).where(
                    FileExtractionModel.id == artifact_id,
                    FileExtractionModel.user_id == user_id,
                    FileExtractionModel.file_id == file_id,
                ),
            )
            file = await session.scalar(
                select(UserFileModel).where(
                    UserFileModel.id == file_id,
                    UserFileModel.user_id == user_id,
                ),
            )

            if artifact is None or file is None:
                return

            await ingest_file(
                extraction=artifact,
                file=file,
                session=session,
                on_caption_request=on_caption_request,
            )
    except Exception:
        # Restart recovery and explicit retry will process the persisted
        # pending artifact; never leak task exceptions from uploads.
        return


async def ingest_file(
    *,
    extraction: FileExtractionModel,
    file: UserFileModel,
    session: AsyncSession,
    on_caption_request: Callable[[str, uuid.UUID, uuid.UUID], None],
) -> FileExtractionModel:

    if extraction.status in (FileKnowledgeArtifactStatus.READY, FileKnowledgeArtifactStatus.CANCELED):
        return extraction

    extraction.status = FileKnowledgeArtifactStatus.PROCESSING
    extraction.error_code = None
    extraction.error_reason = None
    extraction.started_at = get_unix_timestamp()
    await session.commit()

    try:
        processed = await ensure_file_processed(file=file, session=session)
        if processed.content_status is not FileContentStatus.READY:
            raise ExtractionError(processed.content_error or "The file could not be processed")

        vectors, contents, visual_ready = await embed_file(processed)

        chunks: Sequence[VectorChunk] = [
            VectorChunk(
                id=_artifact_chunk_id(extraction, ordinal),
                user_id=processed.user_id,
                file_id=str(processed.id),
                artifact_generation=extraction.generation,
                chunk_ordinal=ordinal,
                content=content,
                vector=vector,
            )
            for ordinal, (content, vector) in enumerate(zip(contents, vectors, strict=True))
        ]
        await vector_store.delete_file_generation(
            user_id=processed.user_id,
            file_id=str(processed.id),
            artifact_generation=extraction.generation,
        )
        await vector_store.add(chunks)

        current_status = await session.scalar(
            select(FileExtractionModel.status).where(
                FileExtractionModel.id == extraction.id,
                FileExtractionModel.file_id == processed.id,
            ),
        )

        if current_status is None:
            raise KnowledgeIngestionError("The file was deleted during processing")

        if current_status is FileKnowledgeArtifactStatus.CANCELED:
            await vector_store.delete_file_generation(
                user_id=processed.user_id,
                file_id=str(processed.id),
                artifact_generation=extraction.generation,
            )
            await session.refresh(extraction)
            return extraction

    except Exception as error:
        try:
            await vector_store.delete_file_generation(
                user_id=file.user_id,
                file_id=str(file.id),
                artifact_generation=extraction.generation,
            )
        except Exception:
            logger.exception("Could not remove partial file knowledge vectors", extra={"file_id": str(file.id)})
        extraction.status = FileKnowledgeArtifactStatus.FAILED
        extraction.error_code = "processing_failed"
        extraction.error_reason = (
            str(error)[:512]
            if isinstance(error, (KnowledgeIngestionError, EmbeddingProviderError))
            else "Knowledge processing failed; check the server logs"
        )
        extraction.completed_at = None
        await session.commit()
        return extraction

    await session.execute(
        update(FileExtractionModel)
        .where(FileExtractionModel.file_id == file.id, FileExtractionModel.is_current.is_(True))
        .values(is_current=False),
    )
    extraction.status = FileKnowledgeArtifactStatus.READY
    extraction.is_current = True
    extraction.extracted_content = processed.content_cache if processed.kind is not FileKind.IMAGE else None
    extraction.chunk_count = len(chunks)
    extraction.text_embeddings_ready = processed.kind is not FileKind.IMAGE
    extraction.visual_embedding_ready = visual_ready
    extraction.completed_at = get_unix_timestamp()

    caption_requested = False
    if processed.kind is FileKind.IMAGE:
        caption_configuration = await get_captioning_configuration(session=session)
        caption_requested = caption_configuration.mode != KnowledgeCaptionMode.DISABLED.value
        extraction.caption_status = KnowledgeCaptionStatus.PENDING if caption_requested else None

    await session.commit()

    if caption_requested:
        on_caption_request(extraction.user_id, file.id, extraction.id)

    return extraction
