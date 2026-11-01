"""Ordered source reading over an injected live scope (ADR-0034).

``RetrievalService`` answers similarity queries. ``SourceReader`` instead reads
the opening chunks of one authorized file in document order, for features that
work through a whole file (such as flashcard drafting). Like the retrieval
service it never touches the database: an injected ``read_snapshot`` reader
reauthorizes against live state, and the snapshot is re-read around the vector
read so a revocation or re-ingestion in between fails that file closed.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from asterism.common.log import get_logger
from asterism.domains.knowledge.models import KnowledgeExtractionStatus
from asterism.domains.knowledge.vector_store import StoredChunk, VectorStore

from .service import RetrievalArtifact, RetrievalSnapshot

logger = get_logger("SOURCES")


class SourceUnavailable(Exception):
    """One file cannot be read right now; ``str(error)`` is safe to show the owner."""


@dataclass(frozen=True)
class SourceChunk:
    file_id: uuid.UUID
    artifact_generation: int
    chunk_id: str
    ordinal: int
    content: str


@dataclass(frozen=True)
class SourceExcerpt:
    """The opening chunks of one file within a character budget.

    Attributes:
        file_id: The file read.
        chunks: Chunks in document order; the last may be clipped to the budget.
        truncated: True when the file has more content than was returned.
    """

    file_id: uuid.UUID
    chunks: tuple[SourceChunk, ...]
    truncated: bool


def _unavailable_reason(artifact: RetrievalArtifact | None) -> str | None:
    if artifact is None:
        return "This file has not been processed yet."
    if artifact.ready:
        return None
    if artifact.status == KnowledgeExtractionStatus.READY:
        return "This file has no readable text."
    if artifact.status in (KnowledgeExtractionStatus.PENDING, KnowledgeExtractionStatus.RUNNING):
        return "This file is still being processed."
    return "This file could not be processed."


class SourceReader:
    def __init__(
        self,
        *,
        user_id: str,
        read_snapshot: Callable[[], Awaitable[RetrievalSnapshot]],
        vectors: VectorStore,
        max_chunks: int,
    ) -> None:
        """Wire the reader to its providers; none of them is owned here.

        Args:
            user_id: Owner of every file read; constrains each vector query.
            read_snapshot: Async reader returning the live authorized snapshot;
                must raise when the context itself is no longer authorized.
            vectors: Store holding knowledge chunks.
            max_chunks: Ceiling on chunks read for one file.
        """
        self.user_id = user_id
        self.read_snapshot = read_snapshot
        self.vectors = vectors
        self.max_chunks = max_chunks

    async def _ready_artifact(self, file_id: uuid.UUID) -> RetrievalArtifact:
        snapshot = await self.read_snapshot()
        if all(file.file_id != file_id for file in snapshot.files):
            raise SourceUnavailable("This file is no longer in the project.")
        artifact = next((item for item in snapshot.artifacts if item.file_id == file_id), None)
        reason = _unavailable_reason(artifact)
        if reason is not None or artifact is None:
            raise SourceUnavailable(reason or "This file has not been processed yet.")
        return artifact

    async def read_file(self, file_id: uuid.UUID, *, max_chars: int) -> SourceExcerpt:
        """Read the opening chunks of one authorized file, up to ``max_chars``.

        Raises:
            SourceUnavailable: The file left scope, is not ready, changed while
                being read, has no text, or the vector store failed.
        """
        if max_chars < 1:
            raise SourceUnavailable("No input budget remains for this file.")
        artifact = await self._ready_artifact(file_id)
        try:
            stored = await self.vectors.get_file_chunks(
                user_id=self.user_id,
                file_id=str(file_id),
                artifact_generation=artifact.generation,
                limit=self.max_chunks,
            )
        except Exception as error:
            logger.warning("source read failed user_id=%s file_id=%s", self.user_id, file_id)
            raise SourceUnavailable("This file could not be read; try again.") from error
        # Re-read so a revocation or re-ingestion during the vector read fails closed.
        current = await self._ready_artifact(file_id)
        if current.generation != artifact.generation:
            raise SourceUnavailable("This file changed while it was being read; try again.")
        return self._budget(file_id, stored, artifact.generation, max_chars)

    def _budget(self, file_id: uuid.UUID, stored: list[StoredChunk], generation: int, max_chars: int) -> SourceExcerpt:
        chunks: list[SourceChunk] = []
        remaining = max_chars
        truncated = len(stored) >= self.max_chunks
        for chunk in stored:
            if chunk.artifact_generation != generation or not chunk.content.strip():
                continue
            if remaining <= 0:
                truncated = True
                break
            content = chunk.content[:remaining]
            truncated = truncated or len(content) < len(chunk.content)
            remaining -= len(content)
            chunks.append(SourceChunk(file_id, generation, chunk.id, chunk.chunk_ordinal, content))
        if not chunks:
            raise SourceUnavailable("This file has no readable text.")
        return SourceExcerpt(file_id, tuple(chunks), truncated)
