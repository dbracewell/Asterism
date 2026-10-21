"""Small project-context reader; no chat or execution-runtime dependencies."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import NotFoundException
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.queries import select_owned_files

from .models import ProjectFileModel, ProjectModel
from .queries import select_owned_projects
from .schemas import Project


async def read_project_context(
    *,
    user_id: str,
    project_id: uuid.UUID,
    session: AsyncSession,
) -> tuple[Project, list[uuid.UUID]]:
    """Read a project plus the ids of its attached files for execution scoping.

    Returns only file *ids* (not file rows) so chat/execution callers can apply
    their own file-scope policy without this module importing runtime concerns.
    The membership subquery re-checks ownership, and the owned-files base select
    drops its default ordering (``order_by(None)``) because id sets need no sort.
    """
    project = await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    memberships = select(ProjectFileModel.file_id).where(
        ProjectFileModel.user_id == user_id,
        ProjectFileModel.project_id == project_id,
    )
    files = await session.scalars(
        select_owned_files(user_id=user_id)
        .with_only_columns(UserFileModel.id)
        .order_by(None)
        .where(UserFileModel.id.in_(memberships)),
    )
    return Project.model_validate(project), list(files)


async def require_owned_project(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> ProjectModel:
    """Cross-domain ownership guard: fetch an owned project row or raise 404.

    The canonical version of this check for *other* domains (chat, files); the
    projects service keeps its own private copy for internal writes. Foreign
    and missing ids are indistinguishable to avoid leaking existence.
    """
    project = await session.scalar(
        select_owned_projects(user_id=user_id)
        .where(
            ProjectModel.id == project_id,
        )
        .execution_options(populate_existing=True)
    )
    if project is None:
        raise NotFoundException("Project not found")
    return project
