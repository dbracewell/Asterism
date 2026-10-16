"""Owner-scoped extraction selects; callers narrow file IDs before execution."""

from sqlalchemy import select

from .models import FileExtractionModel


def select_current_owned_artifacts(user_id: str):
    return select(FileExtractionModel).where(
        FileExtractionModel.user_id == user_id,
        FileExtractionModel.is_current.is_(True),
    )
