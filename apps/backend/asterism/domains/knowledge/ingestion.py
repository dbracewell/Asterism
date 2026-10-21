"""Bounded, idempotent processing of canonical file-artifact generations."""

import hashlib
import logging
import uuid
from collections.abc import Callable, Sequence

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.db.mixins import get_unix_timestamp
from asterism.domains.knowledge.policy import get_captioning_configuration

from .embedding import EmbeddingProvider, EmbeddingProviderError, embedding_provider
from .extractions import load_artifact_extractions
from .model_download import DownloadNotReadyError
from .models import (
    FileKnowledgeArtifactModel,
    FileKnowledgeExtractionModel,
    KnowledgeCaptionMode,
    KnowledgeExtractionKind,
    KnowledgeExtractionStatus,
)
from .retention import prune_superseded_generations
from .sources import SourceContent, SourceReader, get_source_reader
from .vector_store import VectorChunk, vector_store

logger = logging.getLogger(__name__)

TEXT_EXTRACTION_PROVIDER = "markitdown"
"""The provider that converts a source file into its extracted text."""

EMBEDDING_PROVIDER = "onnx-clip"
"""The provider that turns chunks and images into vectors."""


class KnowledgeIngestionError(RuntimeError):
    """A document could not safely be made searchable."""


class KnowledgeArtifactError(RuntimeError):
    """A source file could not be read well enough to derive knowledge from it."""


async def sync_captioning_extraction(
    *,
    artifact: FileKnowledgeArtifactModel,
    session: AsyncSession,
    requested: bool,
) -> None:
    """Create, reset, or remove an artifact's captioning output.

    A caption only applies to an image whose captioning is enabled, so the
    output exists exactly when it is going to be produced.

    Args:
        artifact: The artifact whose captioning output is synchronized.
        session: Active async session; the caller owns the transaction.
        requested: Whether a caption is going to be produced.
    """
    existing = await session.scalar(
        select(FileKnowledgeExtractionModel).where(
            FileKnowledgeExtractionModel.artifact_id == artifact.id,
            FileKnowledgeExtractionModel.kind == KnowledgeExtractionKind.CAPTIONING,
        ),
    )
    if not requested:
        if existing is not None:
            await session.delete(existing)
        return
    if existing is None:
        session.add(
            FileKnowledgeExtractionModel(
                artifact_id=artifact.id,
                kind=KnowledgeExtractionKind.CAPTIONING,
                status=KnowledgeExtractionStatus.PENDING,
            )
        )
        return
    existing.status = KnowledgeExtractionStatus.PENDING
    existing.provider = None
    existing.model = None
    existing.error_code = None
    existing.error_reason = None
    existing.payload = None
    existing.started_at = None
    existing.completed_at = None


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


async def embed_file(
    source: SourceContent,
    *,
    provider: EmbeddingProvider = embedding_provider,
) -> tuple[list[list[float]], list[str], bool]:
    if source.file.is_image:
        contents = [f"Image file: {source.file.name}"]
        vectors = await provider.embed_image([source.file.path])
        visual_ready = True
    else:
        contents = chunk_text(source.text or "")
        vectors = await provider.embed_text(contents)
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
                select(FileKnowledgeArtifactModel).where(
                    FileKnowledgeArtifactModel.id == artifact_id,
                    FileKnowledgeArtifactModel.user_id == user_id,
                    FileKnowledgeArtifactModel.file_id == file_id,
                ),
            )
            if artifact is None:
                return

            await ingest_file(
                artifact=artifact,
                reader=get_source_reader(),
                session=session,
                on_caption_request=on_caption_request,
            )
    except Exception:
        # Restart recovery and explicit retry will process the persisted
        # pending artifact; never leak task exceptions from uploads.
        return


async def ingest_file(
    *,
    artifact: FileKnowledgeArtifactModel,
    reader: SourceReader,
    session: AsyncSession,
    on_caption_request: Callable[[str, uuid.UUID, uuid.UUID], None] = lambda *_: None,
    provider: EmbeddingProvider = embedding_provider,
    store=vector_store,
) -> FileKnowledgeArtifactModel:

    if artifact.status in (KnowledgeExtractionStatus.READY, KnowledgeExtractionStatus.CANCELED):
        return artifact

    extractions = await load_artifact_extractions(artifact_id=artifact.id, session=session)
    text_extraction = extractions.get(KnowledgeExtractionKind.TEXT_EXTRACTION)
    embedding = extractions.get(KnowledgeExtractionKind.EMBEDDING)

    artifact.status = KnowledgeExtractionStatus.RUNNING
    artifact.error_code = None
    artifact.error_reason = None
    artifact.started_at = get_unix_timestamp()
    for extraction in (text_extraction, embedding):
        if extraction is not None:
            extraction.status = KnowledgeExtractionStatus.RUNNING
            extraction.error_code = None
            extraction.error_reason = None
            extraction.started_at = artifact.started_at
    await session.commit()

    stage = KnowledgeExtractionKind.TEXT_EXTRACTION
    try:
        # Reading the source is the text extraction: it converts the stored
        # bytes into the text the embedding is built from.
        source = await reader.read_source(
            file_id=artifact.file_id,
            user_id=artifact.user_id,
            session=session,
        )
        if text_extraction is not None:
            text_extraction.status = KnowledgeExtractionStatus.READY
            text_extraction.provider = TEXT_EXTRACTION_PROVIDER
            text_extraction.payload = {
                "content": source.text if not source.file.is_image else None
            }
            text_extraction.completed_at = get_unix_timestamp()

        stage = KnowledgeExtractionKind.EMBEDDING
        vectors, contents, visual_ready = await embed_file(source, provider=provider)

        chunks: Sequence[VectorChunk] = [
            VectorChunk(
                id=_artifact_chunk_id(artifact, ordinal),
                user_id=source.file.user_id,
                file_id=str(source.file.id),
                artifact_generation=artifact.generation,
                chunk_ordinal=ordinal,
                kind="text",
                content=content,
                vector=vector,
            )
            for ordinal, (content, vector) in enumerate(zip(contents, vectors, strict=True))
        ]
        await store.delete_file_generation(
            user_id=source.file.user_id,
            file_id=str(source.file.id),
            artifact_generation=artifact.generation,
        )
        await store.add(chunks)

        current_status = await session.scalar(
            select(FileKnowledgeArtifactModel.status).where(
                FileKnowledgeArtifactModel.id == artifact.id,
                FileKnowledgeArtifactModel.file_id == source.file.id,
            ),
        )

        if current_status is None:
            raise KnowledgeIngestionError("The file was deleted during processing")

        if current_status is KnowledgeExtractionStatus.CANCELED:
            await store.delete_file_generation(
                user_id=source.file.user_id,
                file_id=str(source.file.id),
                artifact_generation=artifact.generation,
            )
            await session.refresh(artifact)
            return artifact

    except DownloadNotReadyError:
        artifact.status = KnowledgeExtractionStatus.PENDING
        artifact.error_code = "embedding_bundle_pending"
        artifact.error_reason = "Knowledge embedding bundle is still provisioning"
        artifact.started_at = None
        if embedding is not None:
            embedding.status = KnowledgeExtractionStatus.PENDING
            embedding.error_code = "embedding_bundle_pending"
            embedding.error_reason = "Knowledge embedding bundle is still provisioning"
            embedding.started_at = None
        await session.commit()
        return artifact
    except Exception as error:
        try:
            await store.delete_file_generation(
                user_id=artifact.user_id,
                file_id=str(artifact.file_id),
                artifact_generation=artifact.generation,
            )
        except Exception:
            logger.exception(
                "Could not remove partial file knowledge vectors",
                extra={"file_id": str(artifact.file_id)},
            )
        artifact.status = KnowledgeExtractionStatus.FAILED
        artifact.error_code = "processing_failed"
        artifact.error_reason = (
            str(error)[:512]
            if isinstance(error, (KnowledgeIngestionError, EmbeddingProviderError))
            else "Knowledge processing failed; check the server logs"
        )
        artifact.completed_at = None
        # The output that was in flight when the work failed is the one that
        # failed; the outputs that never ran keep their pending state.
        failed = text_extraction if stage == KnowledgeExtractionKind.TEXT_EXTRACTION else embedding
        if failed is not None:
            failed.status = KnowledgeExtractionStatus.FAILED
            failed.error_code = artifact.error_code
            failed.error_reason = artifact.error_reason
            failed.completed_at = get_unix_timestamp()
        await session.commit()
        # This generation is settled and superseded; enforce the retention
        # window so dead generations cannot accumulate.
        await prune_superseded_generations(
            user_id=artifact.user_id,
            file_id=artifact.file_id,
            session=session,
            store=store,
        )
        return artifact

    await session.execute(
        update(FileKnowledgeArtifactModel)
        .where(
            FileKnowledgeArtifactModel.file_id == source.file.id,
            FileKnowledgeArtifactModel.is_current.is_(True),
        )
        .values(is_current=False),
    )
    artifact.status = KnowledgeExtractionStatus.READY
    artifact.is_current = True
    artifact.chunk_count = len(chunks)
    artifact.searchable = not source.file.is_image
    artifact.completed_at = get_unix_timestamp()

    if embedding is not None:
        embedding.status = KnowledgeExtractionStatus.READY
        embedding.provider = EMBEDDING_PROVIDER
        embedding.payload = {
            "text_ready": not source.file.is_image,
            "visual_ready": visual_ready,
        }
        embedding.completed_at = get_unix_timestamp()

    caption_requested = False
    if source.file.is_image:
        caption_configuration = await get_captioning_configuration(session=session)
        caption_requested = caption_configuration.mode != KnowledgeCaptionMode.DISABLED.value
    await sync_captioning_extraction(
        artifact=artifact,
        session=session,
        requested=caption_requested,
    )

    await session.commit()

    # The promoted generation supersedes the older ones. Prune the ones
    # outside the retention window now that the promotion is durable.
    await prune_superseded_generations(
        user_id=artifact.user_id,
        file_id=artifact.file_id,
        session=session,
        store=store,
    )

    if caption_requested:
        on_caption_request(artifact.user_id, source.file.id, artifact.id)

    return artifact
