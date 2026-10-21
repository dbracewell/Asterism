"""Retrieval orchestration over injected live scope, embedding, and vector readers.

The service is deliberately scope-agnostic: it never touches the database or
admin policy itself. The composition root
(``chat.retrieval.create_retrieval_service``) injects a ``read_scope`` reader
that reauthorizes the execution against live state and returns an authorized
snapshot, plus embedding/vector providers and config-derived limits. Because
authorization state can change (revocation, branch changes) at any moment, every
search re-reads the scope around each side effect so that a revocation between
steps fails closed instead of serving stale results.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from pydantic import BaseModel, Field

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, CodedException
from asterism.domains.agent.context_provenance import ContextProvenance, describe_context
from asterism.domains.agent.execution_scope import ExecutionScope, FileProvenance
from asterism.domains.knowledge.embedding import EmbeddingProvider
from asterism.domains.knowledge.models import FileKnowledgeArtifactStatus
from asterism.domains.knowledge.vector_store import VectorSearchResult, VectorStore

logger = get_logger("RETRIEVAL")


@dataclass(frozen=True)
class RetrievalArtifact:
    """Point-in-time state of one file's knowledge artifact.

    Attributes:
        file_id: The file this artifact belongs to.
        generation: Artifact generation (increments on re-ingestion); used to
            discard vector matches produced by an older generation than the
            one currently authorized.
        status: Lifecycle status of the knowledge artifact (pending/ready/...).
        text_embeddings_ready: Whether the text chunks are embedded and
            searchable; a READY artifact can still lack text embeddings.
    """

    file_id: uuid.UUID
    generation: int
    status: FileKnowledgeArtifactStatus
    text_embeddings_ready: bool

    @property
    def ready(self) -> bool:
        """True when the artifact is READY and its text embeddings are searchable."""
        return self.status == FileKnowledgeArtifactStatus.READY and self.text_embeddings_ready


@dataclass(frozen=True)
class RetrievalSnapshot:
    """One authorized, point-in-time view of what a search may touch.

    Produced by the injected ``read_scope`` reader after live reauthorization.

    Attributes:
        files: Provenance for every file authorized at read time (source
            membership and attaching message ids).
        artifacts: Artifact states for a subset of those files; files without
            an artifact are simply absent from this tuple.
        context_revision: Project prompt revision backing this snapshot, or
            None for General chats; identifies the context generation for
            future derived-context keys.
    """

    files: tuple[FileProvenance, ...]
    artifacts: tuple[RetrievalArtifact, ...]
    context_revision: int | None


@dataclass(frozen=True)
class RetrievalLimits:
    """Immutable server-side ceilings for one retrieval service instance.

    Sourced from config at composition time; they bound what the model can ask
    for regardless of its arguments.

    Attributes:
        top_k: Maximum number of chunks a single search may request.
        allowed_files: Maximum number of authorized files before searching is
            refused outright for this context.
        result_bytes: Total UTF-8 byte budget shared across all hit excerpts in
            one response.
    """

    top_k: int
    allowed_files: int
    result_bytes: int


class RetrievalHit(BaseModel):
    """One matching chunk with enough provenance for the model to cite it.

    Attributes:
        file_id: File the excerpt came from.
        sources: Where the file is authorized from ("project"/"chat").
        message_ids: Chat messages that attached this file, if any.
        artifact_generation: Generation of the artifact the chunk was extracted from.
        chunk_id: Vector-store chunk id (stable within one generation).
        score: Normalized cosine similarity of the match in [-1, 1]; higher is
            more similar (converted from the store's squared-L2 distance over
            unit-normalized vectors).
        match_kind: Chunk provenance as stored ("caption" or "text").
        excerpt: Byte-budgeted excerpt of the chunk content.
    """

    file_id: uuid.UUID
    sources: tuple[str, ...]
    message_ids: tuple[uuid.UUID, ...]
    artifact_generation: int
    chunk_id: str
    score: float
    match_kind: str
    excerpt: str


class RetrievalResponse(BaseModel):
    """Envelope returned by :meth:`RetrievalService.search`.

    A search that cannot run (limits exceeded, no ready artifacts, provider
    failure) returns an empty ``results`` list with a human-readable
    ``message`` explaining why, rather than raising.

    Attributes:
        results: Matching chunks, best match first.
        count: Number of entries in ``results``.
        message: Explanation when no results were produced; None on success.
        file_states: Per-file status so the model can see what is and is not
            searchable in this context.
        scope: Compact summary of the execution scope this search ran under.
        provenance: Full content-free provenance for audit/future derived context.
    """

    results: list[RetrievalHit] = Field(default_factory=list)
    count: int = 0
    message: str | None = None
    file_states: list[dict[str, str]] = Field(default_factory=list)
    scope: dict[str, str | int | None]
    provenance: ContextProvenance


def _file_status(artifact: RetrievalArtifact | None) -> str:
    """Map one artifact state to the status string reported to the model.

    Args:
        artifact: The file's artifact state, or None when no artifact exists.

    Returns:
        "unavailable" for missing artifacts, "not_searchable" for READY
        artifacts without text embeddings (the file exists but its text can
        never match), and the artifact's lifecycle status value otherwise.
    """
    if artifact is None:
        return "unavailable"
    if artifact.status == FileKnowledgeArtifactStatus.READY and not artifact.text_embeddings_ready:
        # The file exists and was extracted, but its text was never embedded
        # (embedding failed or the provider is pending); report that state
        # instead of implying the file does not exist.
        return "not_searchable"
    return artifact.status.value


def _file_states(snapshot: RetrievalSnapshot) -> list[dict[str, str]]:
    """Summarize each authorized file's searchability for the model.

    Args:
        snapshot: The authorized snapshot to summarize; per-file status is
            derived by :func:`_file_status`.

    Returns:
        One ``{"file_id", "status"}`` pair per authorized file, in snapshot order.
    """
    artifacts = {artifact.file_id: artifact for artifact in snapshot.artifacts}
    return [
        {"file_id": str(file.file_id), "status": _file_status(artifacts.get(file.file_id))}
        for file in snapshot.files
    ]


def _similarity(distance: float) -> float:
    """Convert the store's squared-L2 distance into cosine similarity.

    All knowledge vectors are L2-normalized at embedding time, so for unit
    vectors |q - v|^2 = 2 * (1 - cos(theta)); invert that relationship and
    clamp to the cosine range.

    Args:
        distance: Raw LanceDB squared-L2 distance for one match (lower is closer).

    Returns:
        Cosine similarity in [-1, 1]; higher means more similar.
    """
    return min(1.0, max(-1.0, 1.0 - distance / 2.0))


def _bounded_excerpt(content: str, remaining_bytes: int) -> str:
    """Truncate ``content`` to fit the remaining byte budget.

    Args:
        content: Full chunk text to excerpt.
        remaining_bytes: UTF-8 bytes still available in the response budget;
            a trailing partially-cut multi-byte character is dropped rather
            than emitted as invalid UTF-8.

    Returns:
        The longest prefix of ``content`` that fits, possibly empty.
    """
    return content.encode("utf-8")[:remaining_bytes].decode("utf-8", errors="ignore")


class RetrievalService:
    """Runs scoped knowledge searches against injected providers.

    All authorization happens inside the injected ``read_scope`` reader; this
    class only orchestrates embedding, vector search, and result enrichment,
    applying the immutable :class:`RetrievalLimits` at each boundary.
    """

    def __init__(
        self,
        *,
        read_scope: Callable[[ExecutionScope], Awaitable[RetrievalSnapshot]],
        embeddings: EmbeddingProvider,
        vectors: VectorStore,
        limits: RetrievalLimits,
    ) -> None:
        """Wire the service to its providers; none of them is owned here.

        Args:
            read_scope: Async reader that reauthorizes ``scope`` against live
                state and returns an authorized snapshot; must raise when the
                context no longer permits retrieval.
            embeddings: Provider used to embed search queries.
            vectors: Store holding knowledge chunks, queried with owner and
                file-id filters only.
            limits: Immutable server-side ceilings for this service instance.
        """
        self.read_scope = read_scope
        self.embeddings = embeddings
        self.vectors = vectors
        self.limits = limits

    async def _read(self, scope: ExecutionScope) -> RetrievalSnapshot:
        """Re-read the authorized snapshot and clamp it to the execution ceiling.

        Args:
            scope: The immutable execution scope this search runs under; its
                ``allowed_file_ids`` is the hard ceiling for every result.

        Returns:
            A snapshot containing only files (and their artifacts) inside the
            scope's allowed file ids.

        Raises:
            BadDataException: When no file remains authorized, or when the
                injected reader reports the context as unauthorized.
        """
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
        """Assemble the response envelope for a search outcome.

        Args:
            scope: Execution scope; summarized into ``scope`` and expanded into
                full ``provenance`` via :func:`describe_context`.
            snapshot: Snapshot used to report per-file states.
            message: Human-readable explanation when no results were produced.
            results: Matching hits, if any.
        """
        return RetrievalResponse(
            provenance=describe_context(scope),
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
        """Search authorized knowledge chunks for ``query``.

        Pipeline: validate the scope and arguments, gate on config limits and
        artifact readiness, embed the query, vector-search only the ready files
        of this exact execution, then re-read the scope and enrich matches.
        The scope is deliberately re-read around each side effect (embedding,
        vector search): a revocation or context change between steps yields an
        empty "unavailable" response instead of stale results, while coded
        authorization errors always propagate.

        Args:
            scope: Immutable execution scope; its ``allowed_file_ids`` and
                ``effective_internal_tools`` are the hard authorization ceiling.
            query: Free-text search query (must be non-blank, at most 2000 chars).
            top_k: Requested number of chunks; must be positive. Values above
                :attr:`RetrievalLimits.top_k` are clamped to it rather than refused.

        Returns:
            A response with hits on success, or empty results plus an
            explanatory ``message`` when the context or providers cannot serve
            the search.

        Raises:
            BadDataException: When retrieval is not authorized for this scope
                or the arguments are invalid.
        """
        if not scope.allowed_file_ids or "search_knowledge" not in scope.effective_internal_tools:
            raise BadDataException("Retrieval is unavailable in this execution context")
        if not query.strip() or len(query) > 2000 or top_k < 1:
            raise BadDataException("Invalid retrieval query or result count")
        # Clamp over-limit requests instead of refusing them: a large ask still gets results.
        top_k = min(top_k, self.limits.top_k)
        # 1. Gate on limits and readiness before spending an embedding call.
        snapshot = await self._read(scope)
        if len(snapshot.files) > self.limits.allowed_files:
            return self._response(scope, snapshot, message="Context exceeds the searchable file limit.")
        if not any(artifact.ready for artifact in snapshot.artifacts):
            return self._response(
                scope,
                snapshot,
                message="No searchable artifacts are ready; files may be pending, failed, or unavailable.",
            )
        try:
            # 2. Embed the query, then re-read so the file set passed to the
            #    vector store reflects live authorization, not step-1 state.
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
            # Coded errors are authorization/validation failures: surface them.
            raise
        except Exception:
            # Authorization must win over a provider error concurrent with revocation;
            # log the original failure for audit, then fail closed on the re-read.
            logger.exception(
                "retrieval provider failed; failing closed user_id=%s chat_id=%s",
                scope.user_id,
                scope.chat_id,
            )
            snapshot = await self._read(scope)
            return self._response(
                scope, snapshot, message="Retrieval is unavailable; retry when the embedding/vector service is ready."
            )
        # 3. Re-read once more so enrichment never trusts state from before the
        #    vector search: a file revoked during the query drops out here and
        #    its matches are discarded by _enrich's generation cross-checks.
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
        """Turn raw vector matches into provenance-verified hits.

        A match is kept only if it survives every cross-check below; otherwise
        it is silently dropped (never an error), since stale matches are the
        expected outcome of a concurrent revocation or re-ingestion.

        Args:
            scope: Execution scope; the match's owner must equal its user.
            snapshot: Freshly re-read snapshot used for artifact/file state and
                provenance (post-vector-search).
            queried: Ready artifacts from the snapshot taken *before* the
                vector search; matches whose file or generation is missing or
                changed between the two reads are discarded.
            matches: Raw vector-store results, best match first.
            top_k: Maximum number of hits to emit (also bounds the loop).

        Returns:
            Hits in original match order, each excerpt clipped so the whole
            list fits :attr:`RetrievalLimits.result_bytes`.
        """
        # Ready artifacts/files from the fresh snapshot, keyed by file id.
        artifacts = {str(artifact.file_id): artifact for artifact in snapshot.artifacts if artifact.ready}
        files = {str(file.file_id): file for file in snapshot.files}
        remaining = self.limits.result_bytes
        results: list[RetrievalHit] = []
        for match in matches:
            artifact = artifacts.get(match.file_id)
            previous = queried.get(match.file_id)
            # Drop the match unless: it belongs to this user, the file is still
            # authorized and ready in the fresh snapshot, its generation matches
            # both the stored chunk and the pre-search read (catches a
            # re-ingestion between reads), and the byte budget/top_k remain.
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
                    score=_similarity(match.score),
                    match_kind=match.kind,
                    excerpt=excerpt,
                )
            )
        return results
