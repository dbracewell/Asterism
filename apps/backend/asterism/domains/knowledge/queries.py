"""Owner-scoped knowledge artifact selects; callers narrow file IDs before execution."""

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, and_, func, or_, select

from .models import (
    INTERRUPTED_ERROR_CODE,
    FileKnowledgeArtifactModel,
    FileKnowledgeExtractionModel,
    KnowledgeExtractionKind,
    KnowledgeExtractionStatus,
)


def select_current_owned_artifacts(user_id: str):
    """Select the current artifact of every file owned by *user_id*.

    Args:
        user_id: Owner whose artifacts are selected.

    Returns:
        A select over the owner's current artifact generations.
    """
    return select(FileKnowledgeArtifactModel).where(
        FileKnowledgeArtifactModel.user_id == user_id,
        FileKnowledgeArtifactModel.is_current.is_(True),
    )


def select_owned_artifact_ids(user_id: str):
    """Select the id of every artifact generation owned by *user_id*, in a stable order.

    Args:
        user_id: Owner whose artifact ids are selected.

    Returns:
        A select over artifact ids, current and superseded alike.
    """
    return (
        select(FileKnowledgeArtifactModel.id)
        .where(FileKnowledgeArtifactModel.user_id == user_id)
        .order_by(FileKnowledgeArtifactModel.id)
    )


def select_file_artifacts(file_ids: Sequence[uuid.UUID]) -> Select[tuple[FileKnowledgeArtifactModel]]:
    """Select every artifact generation of the given files, newest first.

    Args:
        file_ids: Files whose generations are selected.

    Returns:
        A select over all generations of those files, ordered by descending
        generation number so the first row per file is its newest generation.
    """
    return (
        select(FileKnowledgeArtifactModel)
        .where(FileKnowledgeArtifactModel.file_id.in_(file_ids))
        .order_by(FileKnowledgeArtifactModel.generation.desc())
    )


def select_newest_file_artifact(file_id: uuid.UUID) -> Select[tuple[FileKnowledgeArtifactModel]]:
    """Select the newest artifact generation of one file.

    Args:
        file_id: File whose newest generation is selected.

    Returns:
        A select limited to the highest generation number of that file.
    """
    return (
        select(FileKnowledgeArtifactModel)
        .where(FileKnowledgeArtifactModel.file_id == file_id)
        .order_by(FileKnowledgeArtifactModel.generation.desc())
        .limit(1)
    )


def select_artifact_extractions(
    artifact_ids: Sequence[uuid.UUID],
) -> Select[tuple[FileKnowledgeExtractionModel]]:
    """Select the derived outputs of the given artifacts.

    Args:
        artifact_ids: Artifacts whose outputs are selected.

    Returns:
        A select over the extraction rows of those artifacts.
    """
    return select(FileKnowledgeExtractionModel).where(FileKnowledgeExtractionModel.artifact_id.in_(artifact_ids))


def select_resumable_captioning_artifacts() -> Select[tuple[FileKnowledgeArtifactModel]]:
    """Select current, unsearchable artifacts whose caption was never produced.

    That is captioning still ``pending`` (queued work lost at shutdown) or
    ``failed`` only because a restart interrupted it. Other failures stay
    failed; resuming them would retry a broken provider on every restart.
    Spans all users: only the startup resume calls it.

    Returns:
        A select over those artifacts, in a stable order.
    """
    captioning = FileKnowledgeExtractionModel
    return (
        select(FileKnowledgeArtifactModel)
        .join(captioning, captioning.artifact_id == FileKnowledgeArtifactModel.id)
        .where(
            FileKnowledgeArtifactModel.is_current.is_(True),
            FileKnowledgeArtifactModel.status == KnowledgeExtractionStatus.READY,
            FileKnowledgeArtifactModel.searchable.is_(False),
            captioning.kind == KnowledgeExtractionKind.CAPTIONING,
            or_(
                captioning.status == KnowledgeExtractionStatus.PENDING,
                and_(
                    captioning.status == KnowledgeExtractionStatus.FAILED,
                    captioning.error_code == INTERRUPTED_ERROR_CODE,
                ),
            ),
        )
        .order_by(FileKnowledgeArtifactModel.id)
    )


def select_uncaptioned_image_counts() -> Select[tuple[int, int]]:
    """Count current images search can't find, and those still waiting for a caption.

    Every file except an image is searchable once ready, so a ready, current
    generation that isn't searchable is an image without a caption (ADR-0079).
    """
    waiting = select(FileKnowledgeExtractionModel.artifact_id).where(
        FileKnowledgeExtractionModel.kind == KnowledgeExtractionKind.CAPTIONING,
        FileKnowledgeExtractionModel.status.in_([KnowledgeExtractionStatus.PENDING, KnowledgeExtractionStatus.RUNNING]),
    )
    return select(
        func.count(),
        func.count().filter(FileKnowledgeArtifactModel.id.in_(waiting)),
    ).where(
        FileKnowledgeArtifactModel.is_current.is_(True),
        FileKnowledgeArtifactModel.status == KnowledgeExtractionStatus.READY,
        FileKnowledgeArtifactModel.searchable.is_(False),
    )
