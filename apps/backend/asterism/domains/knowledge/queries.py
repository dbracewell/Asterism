"""Owner-scoped knowledge artifact selects; callers narrow file IDs before execution."""

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, select

from .models import FileKnowledgeArtifactModel, FileKnowledgeExtractionModel


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
    return select(FileKnowledgeExtractionModel).where(
        FileKnowledgeExtractionModel.artifact_id.in_(artifact_ids)
    )
