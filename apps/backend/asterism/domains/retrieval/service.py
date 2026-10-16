"""Retrieval orchestration over injected live scope, embedding, and vector readers."""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from pydantic import BaseModel, Field

from asterism.core.exceptions import BadDataException, CodedException
from asterism.domains.agent.execution_scope import ExecutionScope, FileProvenance
from asterism.domains.extraction.embedding import EmbeddingProvider
from asterism.domains.extraction.models import FileKnowledgeArtifactStatus
from asterism.domains.extraction.vector_store import VectorSearchResult, VectorStore


@dataclass(frozen=True)
class RetrievalArtifact:
    file_id: uuid.UUID
    generation: int
    status: FileKnowledgeArtifactStatus
    text_embeddings_ready: bool
    caption_text: str | None = None

    @property
    def ready(self) -> bool:
        return self.status == FileKnowledgeArtifactStatus.READY and self.text_embeddings_ready


@dataclass(frozen=True)
class RetrievalSnapshot:
    files: tuple[FileProvenance, ...]
    artifacts: tuple[RetrievalArtifact, ...]
    context_revision: int | None


@dataclass(frozen=True)
class RetrievalLimits:
    top_k: int
    allowed_files: int
    result_bytes: int


class RetrievalHit(BaseModel):
    file_id: uuid.UUID
    sources: tuple[str, ...]
    message_ids: tuple[uuid.UUID, ...]
    artifact_generation: int
    chunk_id: str
    score: float
    match_kind: str
    excerpt: str


class RetrievalResponse(BaseModel):
    results: list[RetrievalHit] = Field(default_factory=list)
    count: int = 0
    message: str | None = None
    file_states: list[dict[str, str]] = Field(default_factory=list)
    scope: dict[str, str | int | None]


def _file_states(snapshot: RetrievalSnapshot) -> list[dict[str, str]]:
    artifacts = {artifact.file_id: artifact for artifact in snapshot.artifacts}
    return [
        {
            "file_id": str(file.file_id),
            "status": (
                "unavailable"
                if artifact is None or (artifact.status == FileKnowledgeArtifactStatus.READY and not artifact.ready)
                else artifact.status.value
            ),
        }
        for file in snapshot.files
        for artifact in [artifacts.get(file.file_id)]
    ]


def _bounded_excerpt(content: str, remaining_bytes: int) -> str:
    return content.encode("utf-8")[:remaining_bytes].decode("utf-8", errors="ignore")


class RetrievalService:
    def __init__(
        self,
        *,
        read_scope: Callable[[ExecutionScope], Awaitable[RetrievalSnapshot]],
        embeddings: EmbeddingProvider,
        vectors: VectorStore,
        limits: RetrievalLimits,
    ) -> None:
        self.read_scope = read_scope
        self.embeddings = embeddings
        self.vectors = vectors
        self.limits = limits

    async def _read(self, scope: ExecutionScope) -> RetrievalSnapshot:
        snapshot = await self.read_scope(scope)
        # Enforce the immutable ceiling even if an injected reader returns broader data.
        files = tuple(file for file in snapshot.files if file.file_id in scope.allowed_file_ids)
        if not files:
            raise BadDataException("No files are authorized in this execution context")
        ids = {file.file_id for file in files}
        return RetrievalSnapshot(
            files,
            tuple(artifact for artifact in snapshot.artifacts if artifact.file_id in ids),
            snapshot.context_revision,
        )

    def _response(
        self,
        scope: ExecutionScope,
        snapshot: RetrievalSnapshot,
        *,
        message: str | None = None,
        results: list[RetrievalHit] | None = None,
    ) -> RetrievalResponse:
        return RetrievalResponse(
            results=results or [],
            count=len(results or []),
            message=message,
            file_states=_file_states(snapshot),
            scope={
                "chat_id": str(scope.chat_id),
                "project_id": str(scope.project_id) if scope.project_id else None,
                "agent_id": str(scope.agent_id),
                "configuration_revision": scope.configuration_revision,
                "prompt_revision": scope.prompt_revision,
                "context_revision": snapshot.context_revision,
                "executed_model_id": str(scope.executed_model.id) if scope.executed_model else None,
            },
        )

    async def search(self, scope: ExecutionScope, *, query: str, top_k: int = 5) -> RetrievalResponse:
        if not scope.allowed_file_ids or "search_knowledge" not in scope.effective_internal_tools:
            raise BadDataException("Retrieval is unavailable in this execution context")
        if not query.strip() or len(query) > 2000 or top_k < 1:
            raise BadDataException("Invalid retrieval query or result count")
        snapshot = await self._read(scope)
        if top_k > self.limits.top_k:
            return self._response(scope, snapshot, message="Requested result count exceeds the configured limit.")
        if len(snapshot.files) > self.limits.allowed_files:
            return self._response(scope, snapshot, message="Context exceeds the searchable file limit.")
        if not any(artifact.ready for artifact in snapshot.artifacts):
            return self._response(
                scope,
                snapshot,
                message="No searchable artifacts are ready; files may be pending, failed, or unavailable.",
            )
        try:
            query_vector = (await self.embeddings.embed_text([query]))[0]
            snapshot = await self._read(scope)
            queried = {str(artifact.file_id): artifact for artifact in snapshot.artifacts if artifact.ready}
            if not queried:
                return self._response(scope, snapshot, message="No searchable artifacts remain.")
            matches = await self.vectors.search(
                query_vector,
                user_id=scope.user_id,
                allowed_file_ids=sorted(queried),
                limit=top_k,
            )
        except CodedException:
            raise
        except Exception:
            # Authorization must win over a provider error concurrent with revocation.
            snapshot = await self._read(scope)
            return self._response(
                scope, snapshot, message="Retrieval is unavailable; retry when the embedding/vector service is ready."
            )
        snapshot = await self._read(scope)
        results = self._enrich(scope, snapshot, queried, matches, top_k)
        return self._response(scope, snapshot, results=results)

    def _enrich(
        self,
        scope: ExecutionScope,
        snapshot: RetrievalSnapshot,
        queried: dict[str, RetrievalArtifact],
        matches: list[VectorSearchResult],
        top_k: int,
    ) -> list[RetrievalHit]:
        artifacts = {str(artifact.file_id): artifact for artifact in snapshot.artifacts if artifact.ready}
        files = {str(file.file_id): file for file in snapshot.files}
        remaining = self.limits.result_bytes
        results: list[RetrievalHit] = []
        for match in matches:
            artifact = artifacts.get(match.file_id)
            previous = queried.get(match.file_id)
            if (
                match.user_id != scope.user_id
                or artifact is None
                or previous is None
                or artifact.generation != match.artifact_generation
                or previous.generation != artifact.generation
                or remaining <= 0
                or len(results) >= top_k
            ):
                continue
            excerpt = _bounded_excerpt(match.content, remaining)
            if not excerpt:
                continue
            remaining -= len(excerpt.encode("utf-8"))
            file = files[match.file_id]
            results.append(
                RetrievalHit(
                    file_id=file.file_id,
                    sources=file.sources,
                    message_ids=file.message_ids,
                    artifact_generation=match.artifact_generation,
                    chunk_id=match.id,
                    score=match.score,
                    match_kind="caption"
                    if artifact.caption_text and match.content == artifact.caption_text
                    else "text",
                    excerpt=excerpt,
                )
            )
        return results
