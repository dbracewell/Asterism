"""A file's knowledge processing: its status, reprocessing, cancelling, and files with similar content."""

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import NotFoundException
from asterism.domains.knowledge.artifacts import (
    cancel_processing,
    reset_for_reprocessing,
    similar_files,
)

from .listing import _owned_file, describe_files, file_knowledge_summaries
from .processor import ensure_file_processed as ensure_file_processed
from .queries import (
    select_files_by_ids,
)
from .schemas import SimilarFile, SimilarFileList
from .store import get_file_store as get_file_store


async def get_file_knowledge_status(
    *,
    user_id: str,
    filename: str,
    session: AsyncSession,
):
    """Get the knowledge-artifact status for one of the caller's files.

    The reported artifact is the one that represents the file's knowledge: the
    current generation when one exists (the generation retrieval serves), and
    otherwise the newest generation (the one still being built).

    Args:
        user_id: Owner of the file.
        filename: Display name of the file.
        session: Active async session; no commit happens here.

    Returns:
        The file's representative knowledge artifact.

    Raises:
        NotFoundException: If the file or its artifact does not exist.
    """
    file = await _owned_file(user_id=user_id, filename=filename, session=session)
    summaries = await file_knowledge_summaries(file_ids=[file.id], session=session)
    artifact = summaries.get(file.id)
    if artifact is None:
        raise NotFoundException("Knowledge processing record not found")
    return artifact


async def regenerate_file_knowledge(*, user_id: str, filename: str, session: AsyncSession):
    """Re-run knowledge processing for one of the caller's files.

    The newest generation is reset to ``pending`` and re-queued — that is the
    generation representing the latest processing attempt, so a failed
    replacement is retried rather than the serving generation being
    disturbed. Any in-flight job for that artifact is canceled first so the
    retry cannot race the previous run.

    Args:
        user_id: Owner of the file.
        filename: Display name of the file.
        session: Active async session; the reset is committed here.

    Returns:
        The artifact in its reset ``pending`` state.

    Raises:
        NotFoundException: If the file or its artifact does not exist.
    """
    file = await _owned_file(user_id=user_id, filename=filename, session=session)
    artifact = await reset_for_reprocessing(file_id=file.id, session=session)
    if artifact is None:
        raise NotFoundException("Knowledge processing record not found")
    return artifact


async def cancel_file_knowledge_processing(*, user_id: str, filename: str, session: AsyncSession):
    """Cancel in-flight knowledge processing for one of the caller's files.

    The newest generation is targeted, so cancelling a pending replacement
    leaves the current (serving) generation untouched and the file stays
    searchable.

    Args:
        user_id: Owner of the file.
        filename: Display name of the file.
        session: Active async session; the cancellation is committed here.

    Returns:
        The artifact in its current state. Artifacts that are not pending or
        processing are returned unchanged.

    Raises:
        NotFoundException: If the file or its artifact does not exist.
    """
    file = await _owned_file(user_id=user_id, filename=filename, session=session)
    artifact = await cancel_processing(file_id=file.id, session=session)
    if artifact is None:
        raise NotFoundException("Knowledge processing record not found")
    return artifact


_SIMILARITY_MAX_SOURCE_VECTORS = 256


_SIMILARITY_CHUNKS_PER_RESULT = 20


async def get_similar_files(*, user_id: str, filename: str, session: AsyncSession, limit: int = 5) -> SimilarFileList:
    """Find the caller's files most similar to one of their files.

    The query file's centroid direction is computed from its own chunk
    embeddings, searched against the caller's ready current artifacts, and the
    best-matching chunk per candidate file becomes its score.

    Args:
        user_id: Owner the search is scoped to.
        filename: Display name of the query file.
        session: Active async session; no commit happens here.
        limit: Maximum number of similar files to return.

    Returns:
        Ranked similar files with their cosine similarity score. The list is
        empty when the query file has no ready current artifact.

    Raises:
        NotFoundException: If the query file does not exist.
    """
    file = await _owned_file(user_id=user_id, filename=filename, session=session)
    ranked = await similar_files(
        user_id=user_id,
        file_id=file.id,
        limit=limit,
        session=session,
    )
    if not ranked:
        return SimilarFileList(files=[])
    models = {
        str(model.id): model
        for model in await session.scalars(
            select_files_by_ids(user_id=user_id, file_ids=[candidate for candidate, _ in ranked])
        )
    }
    summaries = {
        str(file.id): file
        for file in await describe_files(
            user_id=user_id,
            files=list(models.values()),
            session=session,
        )
    }
    return SimilarFileList(
        files=[
            SimilarFile(file=summaries[str(candidate)], score=score)
            for candidate, score in ranked
            if str(candidate) in models
        ],
    )
