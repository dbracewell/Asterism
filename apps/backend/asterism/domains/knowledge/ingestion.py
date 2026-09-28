"""Bounded, idempotent ingestion of immutable knowledge document revisions."""

import hashlib
import logging
import uuid
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
    KnowledgeDocumentModel,
    KnowledgeDocumentStatus,
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


def _chunk_id(document: KnowledgeDocumentModel, ordinal: int) -> str:
    source = f"{document.id}:{document.revision}:{ordinal}".encode()
    return hashlib.sha256(source).hexdigest()


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
        still_exists = await session.scalar(
            select(FileKnowledgeArtifactModel.id).where(
                FileKnowledgeArtifactModel.id == artifact.id,
                FileKnowledgeArtifactModel.file_id == processed.id,
            )
        )
        if still_exists is None:
            raise KnowledgeIngestionError("The file was deleted during processing")
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
    session.add(record_knowledge_audit(user_id=file.user_id, action="file.processing_ready", file_id=file.id))
    await session.commit()
    return artifact


async def _set_failed(document: KnowledgeDocumentModel, session: AsyncSession, message: str) -> None:
    document.status = KnowledgeDocumentStatus.FAILED
    document.error = message[:512]
    document.indexed_at = None
    session.add(
        record_knowledge_audit(
            user_id=document.user_id,
            action="document.ingestion_failed",
            knowledge_base_id=document.knowledge_base_id,
            document_id=document.id,
        )
    )
    await session.commit()


async def ingest_document(
    *,
    document: KnowledgeDocumentModel,
    file: UserFileModel,
    session: AsyncSession,
    embedding_provider: EmbeddingProvider,
    vector_store: VectorStore,
) -> KnowledgeDocumentModel:
    """Index one pending/failed revision; ready revisions are safe no-ops.

    The relational status is not changed to ``ready`` until vector replacement
    succeeds. A failure removes any partial vector write and records only a
    safe operational reason, never extracted document content.
    """
    if document.status is KnowledgeDocumentStatus.READY:
        return document
    if document.file_id is None:
        await _set_failed(document, session, "The attached file is no longer available")
        return document

    document.status = KnowledgeDocumentStatus.INDEXING
    document.error = None
    document.indexed_at = None
    session.add(
        record_knowledge_audit(
            user_id=document.user_id,
            action="document.indexing_started",
            knowledge_base_id=document.knowledge_base_id,
            document_id=document.id,
        )
    )
    await session.commit()
    try:
        processed = await ensure_file_processed(file=file, session=session)
        if processed.sha256 != document.content_sha256:
            raise KnowledgeIngestionError("The attached file revision no longer matches this document")
        if processed.content_status is not FileContentStatus.READY:
            raise KnowledgeIngestionError(processed.content_error or "The attached file could not be processed")

        if processed.kind is FileKind.IMAGE:
            path = get_file_store().open(processed.user_id, processed.filename)
            vectors = await embedding_provider.embed_image([path])
            contents = [f"Image file: {document.original_name}"]
        else:
            contents = chunk_text(processed.content_cache or "")
            vectors = await embedding_provider.embed_text(contents)
        if len(vectors) != len(contents):
            raise KnowledgeIngestionError("The embedding provider returned an unexpected result count")
        chunks: Sequence[VectorChunk] = [
            VectorChunk(
                id=_chunk_id(document, ordinal),
                user_id=document.user_id,
                file_id=str(processed.id),
                artifact_generation=document.revision,
                chunk_ordinal=ordinal,
                content=content,
                vector=vector,
            )
            for ordinal, (content, vector) in enumerate(zip(contents, vectors, strict=True))
        ]
        # Reindexing is idempotent: stale chunks for this immutable document are
        # removed before the complete replacement is written.
        await vector_store.delete_file_generation(
            user_id=document.user_id,
            file_id=str(processed.id),
            artifact_generation=document.revision,
        )
        await vector_store.add(chunks)
        # A deletion can race with a blocking vector write. Re-check relational
        # ownership after that write so a late worker deletes its own vectors
        # instead of restoring an inaccessible document.
        still_exists = await session.scalar(
            select(KnowledgeDocumentModel.id).where(KnowledgeDocumentModel.id == document.id)
        )
        if still_exists is None:
            raise KnowledgeIngestionError("The document was deleted during indexing")
    except Exception as error:
        # Keep the full diagnostic in operator logs while recording only a safe,
        # actionable category in user-visible document status.
        logger.exception(
            "Knowledge indexing failed",
            extra={
                "knowledge_document_id": str(document.id),
                "knowledge_base_id": str(document.knowledge_base_id),
                "user_id": document.user_id,
            },
        )
        try:
            await vector_store.delete_file_generation(
                user_id=document.user_id,
                file_id=str(file.id),
                artifact_generation=document.revision,
            )
        except Exception:
            logger.exception(
                "Could not remove partial knowledge vectors",
                extra={"knowledge_document_id": str(document.id)},
            )
        message = (
            str(error)
            if isinstance(error, (KnowledgeIngestionError, EmbeddingProviderError))
            else "Knowledge indexing failed; check the server logs"
        )
        await _set_failed(document, session, message)
        return document

    document.status = KnowledgeDocumentStatus.READY
    document.error = None
    document.indexed_at = get_unix_timestamp()
    session.add(
        record_knowledge_audit(
            user_id=document.user_id,
            action="document.indexing_ready",
            knowledge_base_id=document.knowledge_base_id,
            document_id=document.id,
            details={"chunk_count": len(chunks), "revision": document.revision},
        )
    )
    await session.commit()
    return document


async def load_document_for_ingestion(
    *, user_id: str, knowledge_base_id: uuid.UUID, document_id: uuid.UUID, session: AsyncSession
) -> tuple[KnowledgeDocumentModel, UserFileModel] | None:
    document = await session.scalar(
        select(KnowledgeDocumentModel).where(
            KnowledgeDocumentModel.id == document_id,
            KnowledgeDocumentModel.user_id == user_id,
            KnowledgeDocumentModel.knowledge_base_id == knowledge_base_id,
        )
    )
    if document is None or document.file_id is None:
        return None
    file = await session.scalar(
        select(UserFileModel).where(UserFileModel.id == document.file_id, UserFileModel.user_id == user_id)
    )
    return (document, file) if file is not None else None
