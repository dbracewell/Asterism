"""Owner-scoped extraction selects; callers narrow file IDs before execution."""

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, select

from .models import FileExtractionModel


def select_current_owned_artifacts(user_id: str):
    """Select the current artifact of every file owned by *user_id*.

    Args:
        user_id: Owner whose artifacts are selected.

    Returns:
        A select over the owner's current artifact generations.
    """
    return select(FileExtractionModel).where(
        FileExtractionModel.user_id == user_id,
        FileExtractionModel.is_current.is_(True),
    )


def select_file_artifacts(file_ids: Sequence[uuid.UUID]) -> Select[tuple[FileExtractionModel]]:
    """Select every artifact generation of the given files, newest first.

    Args:
        file_ids: Files whose generations are selected.

    Returns:
        A select over all generations of those files, ordered by descending
        generation number so the first row per file is its newest generation.
    """
    return (
        select(FileExtractionModel)
        .where(FileExtractionModel.file_id.in_(file_ids))
        .order_by(FileExtractionModel.generation.desc())
    )


def select_newest_file_artifact(file_id: uuid.UUID) -> Select[tuple[FileExtractionModel]]:
    """Select the newest artifact generation of one file.

    Args:
        file_id: File whose newest generation is selected.

    Returns:
        A select limited to the highest generation number of that file.
    """
    return (
        select(FileExtractionModel)
        .where(FileExtractionModel.file_id == file_id)
        .order_by(FileExtractionModel.generation.desc())
        .limit(1)
    )
