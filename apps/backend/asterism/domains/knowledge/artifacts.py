"""The knowledge domain's published reads and lifecycle for file artifacts.

The files domain consumes this module instead of the artifact model, the
artifact queries, and the ingestion runtime, so the dependency direction is
visible in the code. Everything a caller needs to know about a file's
knowledge is expressed here, in terms of values the knowledge domain owns.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import runtime
from .extractions import describe_artifact, load_artifact_extractions, load_extractions
from .models import FileKnowledgeArtifactModel, KnowledgeExtractionKind, KnowledgeExtractionStatus
from .queries import select_file_artifacts
from .schemas import FileKnowledgeArtifact

_SIMILARITY_MAX_SOURCE_VECTORS = 256
"""Upper bound on the source chunks used to build a file's centroid direction."""

_SIMILARITY_CHUNKS_PER_RESULT = 20
"""How many candidate chunks to pull per requested similar file."""


@dataclass(frozen=True)
class ArtifactSummary:
    """The published view of one knowledge artifact.

    Attributes:
        id: The artifact's identifier.
        file_id: The source file the artifact belongs to.
        generation: The artifact's generation number.
        status: The artifact's lifecycle status.
        is_current: Whether this is the file's current generation.
        chunk_count: How many chunks the artifact indexed.
    """

    id: uuid.UUID
    file_id: uuid.UUID
    generation: int
    status: KnowledgeExtractionStatus
    is_current: bool
    chunk_count: int


def _summary(artifact: FileKnowledgeArtifactModel) -> ArtifactSummary:
    """Project one artifact row onto its published view.

    Args:
        artifact: The stored artifact row.

    Returns:
        The artifact's published summary.
    """
    return ArtifactSummary(
        id=artifact.id,
        file_id=artifact.file_id,
        generation=artifact.generation,
        status=artifact.status,
        is_current=artifact.is_current,
        chunk_count=artifact.chunk_count,
    )


async def reported_artifacts(
    *,
    file_ids: list[uuid.UUID],
    session: AsyncSession,
) -> dict[uuid.UUID, FileKnowledgeArtifact]:
    """Map each file to the artifact generation that represents its knowledge.

    The *current* generation wins: it is the one retrieval serves, so the UI
    and retrieval agree on which generation a file is using. A file that has
    never been processed has no current generation yet, so its newest
    generation is reported instead — that is the one still being built.

    Only the reported generations are described, and only their derived
    outputs are loaded: a discarded generation never reaches the response.

    Args:
        file_ids: Files to look up. An empty list returns an empty mapping.
        session: Active async session; no commit happens here.

    Returns:
        A mapping of file id to its representative artifact. Files without any
        artifact are absent from the mapping.
    """
    if not file_ids:
        return {}
    artifacts = (await session.scalars(select_file_artifacts(file_ids))).all()
    current: dict[uuid.UUID, FileKnowledgeArtifactModel] = {}
    newest: dict[uuid.UUID, FileKnowledgeArtifactModel] = {}
    for artifact in artifacts:
        # The select orders by descending generation, so the first artifact
        # seen for a file is its newest generation.
        newest.setdefault(artifact.file_id, artifact)
        if artifact.is_current:
            current[artifact.file_id] = artifact
    reported = {
        file_id: current.get(file_id, artifact) for file_id, artifact in newest.items()
    }
    extractions = await load_extractions(
        artifact_ids=[artifact.id for artifact in reported.values()],
        session=session,
    )
    return {
        file_id: describe_artifact(artifact, extractions.get(artifact.id, []))
        for file_id, artifact in reported.items()
    }


async def newest_artifact(
    *,
    file_id: uuid.UUID,
    session: AsyncSession,
) -> ArtifactSummary | None:
    """Return a file's newest artifact generation.

    Args:
        file_id: The source file.
        session: Active async session; no commit happens here.

    Returns:
        The newest generation's summary, or ``None`` when the file has none.
    """
    artifact = await session.scalar(
        select(FileKnowledgeArtifactModel)
        .where(FileKnowledgeArtifactModel.file_id == file_id)
        .order_by(FileKnowledgeArtifactModel.generation.desc())
        .limit(1)
    )
    return _summary(artifact) if artifact is not None else None


async def current_ready_artifact(
    *,
    file_id: uuid.UUID,
    session: AsyncSession,
) -> ArtifactSummary | None:
    """Return a file's current ready artifact generation.

    Args:
        file_id: The source file.
        session: Active async session; no commit happens here.

    Returns:
        The current ready generation's summary, or ``None`` when the file has
        none.
    """
    artifact = await session.scalar(
        select(FileKnowledgeArtifactModel).where(
            FileKnowledgeArtifactModel.file_id == file_id,
            FileKnowledgeArtifactModel.is_current.is_(True),
            FileKnowledgeArtifactModel.status == KnowledgeExtractionStatus.READY,
        )
    )
    return _summary(artifact) if artifact is not None else None


async def ready_current_generations(
    *,
    user_id: str,
    exclude_file_id: uuid.UUID,
    session: AsyncSession,
) -> dict[uuid.UUID, int]:
    """Return the owner's other ready current generations.

    Args:
        user_id: The owner whose files are considered.
        exclude_file_id: The file to leave out of the result.
        session: Active async session; no commit happens here.

    Returns:
        A mapping of file id to its current generation.
    """
    rows = await session.execute(
        select(FileKnowledgeArtifactModel.file_id, FileKnowledgeArtifactModel.generation).where(
            FileKnowledgeArtifactModel.user_id == user_id,
            FileKnowledgeArtifactModel.file_id != exclude_file_id,
            FileKnowledgeArtifactModel.is_current.is_(True),
            FileKnowledgeArtifactModel.status == KnowledgeExtractionStatus.READY,
        )
    )
    return {file_id: generation for file_id, generation in rows.all()}


async def similar_files(
    *,
    user_id: str,
    file_id: uuid.UUID,
    limit: int,
    session: AsyncSession,
) -> list[tuple[uuid.UUID, float]]:
    """Rank the owner's other files by similarity to one file.

    The query file's centroid direction is computed from its own chunks and
    compared against the owner's other ready current generations.

    Args:
        user_id: The owner whose files are considered.
        file_id: The file to compare against.
        limit: Maximum number of similar files to return.
        session: Active async session; no commit happens here.

    Returns:
        The ranked file ids and their similarity scores, best first.
    """
    current = await current_ready_artifact(file_id=file_id, session=session)
    if current is None:
        return []
    source_vectors = await runtime.vector_store.get_file_vectors(
        user_id=user_id,
        file_id=str(file_id),
        artifact_generation=current.generation,
        limit=_SIMILARITY_MAX_SOURCE_VECTORS,
    )
    if not source_vectors:
        return []

    # Embeddings are unit-length, so the normalized mean is the file's centroid direction.
    dimension = len(source_vectors[0])
    centroid = [sum(vector[index] for vector in source_vectors) / len(source_vectors) for index in range(dimension)]
    norm = sum(value * value for value in centroid) ** 0.5
    if norm == 0:
        return []
    centroid = [value / norm for value in centroid]

    candidates = await ready_current_generations(
        user_id=user_id,
        exclude_file_id=file_id,
        session=session,
    )
    if not candidates:
        return []
    hits = await runtime.vector_store.search(
        centroid,
        user_id=user_id,
        allowed_file_ids=[str(candidate) for candidate in candidates],
        limit=limit * _SIMILARITY_CHUNKS_PER_RESULT,
    )
    # LanceDB reports squared L2 distance; for unit vectors cosine = 1 - d / 2.
    best: dict[uuid.UUID, float] = {}
    for hit in hits:
        candidate = uuid.UUID(hit.file_id)
        if candidates.get(candidate) != hit.artifact_generation:
            continue
        best[candidate] = max(best.get(candidate, -1.0), min(1.0, max(-1.0, 1 - hit.score / 2)))
    return sorted(best.items(), key=lambda item: item[1], reverse=True)[:limit]


async def ensure_artifact(
    *,
    file_id: uuid.UUID,
    user_id: str,
    session: AsyncSession,
) -> ArtifactSummary:
    """Create the pending canonical artifact for a newly eligible file.

    Args:
        file_id: The source file.
        user_id: The file's owner.
        session: Active async session; the new rows are added but not committed.

    Returns:
        The artifact for the current policy generation.
    """
    from .processing import ensure_file_knowledge_artifact

    artifact = await ensure_file_knowledge_artifact(
        file_id=file_id,
        user_id=user_id,
        session=session,
    )
    return _summary(artifact)


def start_ingestion(
    *,
    user_id: str,
    file_id: uuid.UUID,
    artifact: ArtifactSummary,
) -> bool:
    """Schedule the ingestion of one artifact.

    An artifact that is already being produced, or that has settled, is left
    alone: only a pending or failed generation is started.

    Args:
        user_id: The file's owner.
        file_id: The source file.
        artifact: The artifact to produce.

    Returns:
        Whether the work was scheduled.
    """
    if artifact.status not in {KnowledgeExtractionStatus.PENDING, KnowledgeExtractionStatus.FAILED}:
        return False
    return runtime.start_file_ingestion_job(user_id=user_id, file_id=file_id, artifact_id=artifact.id)


async def reset_for_reprocessing(
    *,
    file_id: uuid.UUID,
    session: AsyncSession,
) -> FileKnowledgeArtifact | None:
    """Reset a file's newest generation and schedule it again.

    The derived outputs are produced again from scratch. The caption only
    exists for images whose captioning is enabled, so it is removed here and
    recreated by the ingestion when it applies.

    Args:
        file_id: The source file.
        session: Active async session; the reset is committed here.

    Returns:
        The reset artifact, or ``None`` when the file has no artifact.
    """
    artifact = await session.scalar(
        select(FileKnowledgeArtifactModel)
        .where(FileKnowledgeArtifactModel.file_id == file_id)
        .order_by(FileKnowledgeArtifactModel.generation.desc())
        .limit(1)
    )
    if artifact is None:
        return None
    await runtime.cancel_file_jobs(artifact.id)
    artifact.status = KnowledgeExtractionStatus.PENDING
    artifact.error_code = None
    artifact.error_reason = None
    artifact.started_at = None
    artifact.completed_at = None
    extractions = await load_artifact_extractions(artifact_id=artifact.id, session=session)
    for kind, extraction in extractions.items():
        if kind is KnowledgeExtractionKind.CAPTIONING:
            await session.delete(extraction)
            continue
        extraction.status = KnowledgeExtractionStatus.PENDING
        extraction.provider = None
        extraction.model = None
        extraction.error_code = None
        extraction.error_reason = None
        extraction.payload = None
        extraction.started_at = None
        extraction.completed_at = None
    await session.commit()
    runtime.start_file_ingestion_job(
        user_id=artifact.user_id,
        file_id=artifact.file_id,
        artifact_id=artifact.id,
    )
    return describe_artifact(
        artifact,
        [
            extraction
            for kind, extraction in extractions.items()
            if kind is not KnowledgeExtractionKind.CAPTIONING
        ],
    )


async def cancel_processing(
    *,
    file_id: uuid.UUID,
    session: AsyncSession,
) -> FileKnowledgeArtifact | None:
    """Cancel a file's in-flight processing.

    The newest generation is targeted, so cancelling a pending replacement
    leaves the current (serving) generation untouched.

    Args:
        file_id: The source file.
        session: Active async session; the cancellation is committed here.

    Returns:
        The artifact in its current state, or ``None`` when the file has no
        artifact. An artifact that is not pending or running is returned
        unchanged.
    """
    artifact = await session.scalar(
        select(FileKnowledgeArtifactModel)
        .where(FileKnowledgeArtifactModel.file_id == file_id)
        .order_by(FileKnowledgeArtifactModel.generation.desc())
        .limit(1)
    )
    if artifact is None:
        return None
    if artifact.status in {KnowledgeExtractionStatus.PENDING, KnowledgeExtractionStatus.RUNNING}:
        await runtime.cancel_file_jobs(artifact.id)
        artifact.status = KnowledgeExtractionStatus.CANCELED
        artifact.error_code = "canceled"
        artifact.error_reason = "Processing canceled by user"
        await session.commit()
    extractions = await load_artifact_extractions(artifact_id=artifact.id, session=session)
    return describe_artifact(artifact, list(extractions.values()))


async def remove_artifacts(*, file_id: uuid.UUID, session: AsyncSession) -> None:
    """Remove every artifact of a source file, cancelling its work first.

    This explicit cleanup is required even though production databases enforce
    foreign keys: deterministic test/development SQLite connections may not
    enable cascade actions.

    Args:
        file_id: The file whose derived state should be removed.
        session: Active async session; no commit happens here (the caller
            owns the transaction).
    """
    artifact_ids = list(
        await session.scalars(
            select(FileKnowledgeArtifactModel.id).where(FileKnowledgeArtifactModel.file_id == file_id),
        ),
    )
    for artifact_id in artifact_ids:
        await runtime.cancel_file_jobs(artifact_id)
    await session.execute(delete(FileKnowledgeArtifactModel).where(FileKnowledgeArtifactModel.file_id == file_id))


async def delete_file_vectors(*, user_id: str, file_id: uuid.UUID) -> None:
    """Remove the vectors of a deleted file.

    Args:
        user_id: The file's owner.
        file_id: The deleted file.
    """
    await runtime.vector_store.delete_file(user_id=user_id, file_id=str(file_id))
