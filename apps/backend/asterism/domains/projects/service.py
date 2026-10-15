"""Owner-scoped project lifecycle; sources and extraction stay outside this domain."""

import uuid
from typing import Literal

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, CodedException, NotFoundException
from asterism.domains.files.schemas import UserFileList

from .models import ProjectFileModel, ProjectModel
from .queries import select_owned_projects
from .schemas import Project, ProjectCreate, ProjectFileBatch, ProjectFileBatchResult, ProjectList, ProjectUpdate

ProjectSort = Literal["name", "created", "updated"]


async def _owned_project(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> ProjectModel:
    project = await session.scalar(
        select_owned_projects(user_id=user_id)
        .where(ProjectModel.id == project_id)
        .execution_options(populate_existing=True),
    )
    if project is None:
        raise NotFoundException("Project not found")
    return project


async def create_project(*, user_id: str, payload: ProjectCreate, session: AsyncSession) -> Project:
    project = ProjectModel(user_id=user_id, **payload.model_dump())
    session.add(project)
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise CodedException(409, "A project with this name already exists") from error
    return Project.model_validate(project)


async def get_project(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> Project:
    return Project.model_validate(await _owned_project(user_id=user_id, project_id=project_id, session=session))


async def list_projects(
    *,
    user_id: str,
    session: AsyncSession,
    page: int = 1,
    page_size: int = 50,
    sort_by: ProjectSort = "name",
    query: str | None = None,
) -> ProjectList:
    if page < 1 or not 1 <= page_size <= 100:
        raise BadDataException("Invalid pagination")
    orders = {
        "name": (ProjectModel.name.asc(), ProjectModel.id.asc()),
        "created": (ProjectModel.created_at.desc(), ProjectModel.id.asc()),
        "updated": (ProjectModel.updated_at.desc(), ProjectModel.id.asc()),
    }
    if sort_by not in orders:
        raise BadDataException("Invalid project sort")
    statement = select_owned_projects(user_id=user_id)
    if search := (query or "").strip():
        # User input is a literal substring, not SQL LIKE wildcard syntax.
        statement = statement.where(
            ProjectModel.name.icontains(search, autoescape=True)
            | ProjectModel.description.icontains(search, autoescape=True),
        )
    total = await session.scalar(select(func.count()).select_from(statement.subquery()))
    records = await session.scalars(
        statement.order_by(*orders[sort_by]).offset((page - 1) * page_size).limit(page_size),
    )
    return ProjectList(
        projects=[Project.model_validate(record) for record in records],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


async def _write_project(
    *,
    user_id: str,
    project_id: uuid.UUID,
    expected_context_revision: int,
    changes: dict,
    advance_revision: bool,
    session: AsyncSession,
) -> ProjectModel:
    current = await _owned_project(user_id=user_id, project_id=project_id, session=session)
    values = dict(changes)
    values["context_revision"] = (
        ProjectModel.context_revision + 1 if advance_revision else ProjectModel.context_revision
    )
    if not changes and not advance_revision:
        values["updated_at"] = current.updated_at
    project = await session.scalar(
        update(ProjectModel)
        .where(
            ProjectModel.id == project_id,
            ProjectModel.user_id == user_id,
            ProjectModel.context_revision == expected_context_revision,
        )
        .values(**values)
        .returning(ProjectModel)
        .execution_options(populate_existing=True),
    )
    if project is None:
        raise CodedException(409, "Project context changed; reload the project and retry")
    return project


async def advance_context_revision(
    *,
    user_id: str,
    project_id: uuid.UUID,
    expected_context_revision: int,
    session: AsyncSession,
) -> int:
    """Advance after a real membership change in the caller's transaction; do not commit.

    Membership APIs in US-24.3 use this before committing their changes. No-op
    membership batches must not call it. Callers roll back the entire transaction
    on failure so a stale revision never leaves partial memberships behind.
    """
    project = await _write_project(
        user_id=user_id,
        project_id=project_id,
        expected_context_revision=expected_context_revision,
        changes={},
        advance_revision=True,
        session=session,
    )
    return project.context_revision


async def update_project(
    *,
    user_id: str,
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    session: AsyncSession,
) -> Project:
    current = await _owned_project(user_id=user_id, project_id=project_id, session=session)
    changes = payload.model_dump(exclude_unset=True, exclude={"expected_context_revision"})
    changes = {key: value for key, value in changes.items() if value != getattr(current, key)}
    prompt_changed = "system_prompt" in changes
    try:
        project = await _write_project(
            user_id=user_id,
            project_id=project_id,
            expected_context_revision=payload.expected_context_revision,
            changes=changes,
            advance_revision=prompt_changed,
            session=session,
        )
        response = Project.model_validate(project)
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise CodedException(409, "A project with this name already exists") from error
    except CodedException:
        await session.rollback()
        raise
    return response


async def delete_project(
    *,
    user_id: str,
    project_id: uuid.UUID,
    expected_context_revision: int,
    session: AsyncSession,
) -> Project:
    """Detach through the chat lifecycle boundary and delete in one transaction.

    Runtime cancellation before project deletion is integrated in US-26.1.
    """
    from asterism.domains.chat.membership import detach_project_chats

    try:
        await _write_project(
            user_id=user_id,
            project_id=project_id,
            expected_context_revision=expected_context_revision,
            changes={},
            advance_revision=False,
            session=session,
        )
        await detach_project_chats(user_id=user_id, project_id=project_id, session=session)
        project = await session.scalar(
            delete(ProjectModel)
            .where(
                ProjectModel.id == project_id,
                ProjectModel.user_id == user_id,
                ProjectModel.context_revision == expected_context_revision,
            )
            .returning(ProjectModel)
        )
        response = Project.model_validate(project)
        await session.commit()
        return response
    except Exception:
        await session.rollback()
        raise


async def change_project_files(
    *,
    user_id: str,
    project_id: uuid.UUID,
    payload: ProjectFileBatch,
    remove: bool,
    session: AsyncSession,
) -> ProjectFileBatchResult:
    from asterism.domains.files.service import validate_owned_file_ids

    ids = sorted(set(payload.file_ids), key=str)
    try:
        # Acquire the project write lock and compare the revision before reading
        # memberships. This also rejects stale no-op requests without bumping it.
        project = await _write_project(
            user_id=user_id,
            project_id=project_id,
            expected_context_revision=payload.expected_context_revision,
            changes={},
            advance_revision=False,
            session=session,
        )
        await validate_owned_file_ids(user_id=user_id, file_ids=ids, session=session)
        existing = set(
            await session.scalars(
                select(ProjectFileModel.file_id).where(
                    ProjectFileModel.project_id == project_id,
                    ProjectFileModel.user_id == user_id,
                    ProjectFileModel.file_id.in_(ids),
                ),
            ),
        )
        changed = [file_id for file_id in ids if (file_id in existing) == remove]
        if changed:
            if remove:
                await session.execute(
                    delete(ProjectFileModel).where(
                        ProjectFileModel.project_id == project_id,
                        ProjectFileModel.user_id == user_id,
                        ProjectFileModel.file_id.in_(changed),
                    ),
                )
            else:
                session.add_all(
                    [ProjectFileModel(project_id=project_id, file_id=file_id, user_id=user_id) for file_id in changed],
                )
            revision = await advance_context_revision(
                user_id=user_id,
                project_id=project_id,
                expected_context_revision=payload.expected_context_revision,
                session=session,
            )
        else:
            revision = project.context_revision
        result = ProjectFileBatchResult(
            context_revision=revision,
            changed_file_ids=changed,
            unchanged_file_ids=[file_id for file_id in ids if file_id not in changed],
        )
        await session.commit()
        return result
    except IntegrityError as error:
        await session.rollback()
        raise CodedException(409, "Project files changed; reload and retry") from error
    except Exception:
        await session.rollback()
        raise


async def list_project_files(
    *,
    user_id: str,
    project_id: uuid.UUID,
    session: AsyncSession,
    page: int = 1,
    page_size: int = 50,
    sort_by: Literal["name", "kind", "date", "size"] = "name",
    query: str | None = None,
) -> UserFileList:
    from asterism.domains.files.listing import list_file_page
    from asterism.domains.files.models import UserFileModel
    from asterism.domains.files.queries import select_owned_files

    await _owned_project(user_id=user_id, project_id=project_id, session=session)
    ids = select(ProjectFileModel.file_id).where(
        ProjectFileModel.project_id == project_id,
        ProjectFileModel.user_id == user_id,
    )
    statement = select_owned_files(user_id=user_id, query=query, sort_by=sort_by).where(UserFileModel.id.in_(ids))
    return await list_file_page(user_id=user_id, statement=statement, session=session, page=page, page_size=page_size)
