"""Project-owned read/cleanup boundary consumed by the file lifecycle."""

import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.files.schemas import FileProjectSummary

from .models import ProjectFileModel, ProjectModel


async def file_project_summaries(
    *,
    user_id: str,
    file_ids: list[uuid.UUID],
    session: AsyncSession,
) -> dict[uuid.UUID, list[FileProjectSummary]]:
    rows = await session.execute(
        select(ProjectFileModel.file_id, ProjectModel)
        .join(ProjectModel, ProjectModel.id == ProjectFileModel.project_id)
        .where(
            ProjectFileModel.user_id == user_id,
            ProjectModel.user_id == user_id,
            ProjectFileModel.file_id.in_(file_ids),
        )
        .order_by(ProjectModel.name, ProjectModel.id),
    )
    summaries: dict[uuid.UUID, list[FileProjectSummary]] = {}
    for file_id, project in rows:
        summaries.setdefault(file_id, []).append(FileProjectSummary.model_validate(project))
    return summaries


async def detach_deleted_file(*, user_id: str, file_id: uuid.UUID, session: AsyncSession) -> None:
    # Serialize against membership writes before removing their references. Each
    # affected project's context changes once, in the source deletion transaction.
    await session.execute(
        update(ProjectModel)
        .where(
            ProjectModel.user_id == user_id,
            ProjectModel.id.in_(
                select(ProjectFileModel.project_id).where(
                    ProjectFileModel.user_id == user_id,
                    ProjectFileModel.file_id == file_id,
                ),
            ),
        )
        .values(context_revision=ProjectModel.context_revision + 1),
    )
    await session.execute(
        delete(ProjectFileModel).where(
            ProjectFileModel.user_id == user_id,
            ProjectFileModel.file_id == file_id,
        ),
    )
