"""Owner-scoped project lifecycle; sources and knowledge stay outside this domain."""

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

# Sort keys accepted by list_projects; mirrored by the router's Literal.
ProjectSort = Literal["name", "created", "updated"]


async def _owned_project(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> ProjectModel:
    """Fetch a project row proving ownership, or 404 without leaking existence.

    Foreign and missing ids are indistinguishable to the caller. Uses
    ``populate_existing`` so a row already in the identity map is refreshed
    from the database before mutation decisions are made on it.
    """
    project = await session.scalar(
        select_owned_projects(user_id=user_id)
        .where(ProjectModel.id == project_id)
        .execution_options(populate_existing=True),
    )
    if project is None:
        raise NotFoundException("Project not found")
    return project


async def create_project(*, user_id: str, payload: ProjectCreate, session: AsyncSession) -> Project:
    """Create a project; the unique (user, name) constraint maps to a 409."""
    project = ProjectModel(user_id=user_id, **payload.model_dump())
    session.add(project)
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise CodedException(409, "A project with this name already exists") from error
    return Project.model_validate(project)


async def get_project(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> Project:
    """Read one owned project as the wire model (404 if missing/foreign)."""
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
    """Paginated, optionally searched list of the caller's projects.

    ``query`` is a literal case-insensitive substring matched against name and
    description (wildcards are escaped, not interpreted). Pagination/sort bounds
    are re-checked here even though the router already constrains them, so the
    service stays safe for non-HTTP callers.
    """
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
    """Compare-and-set write on ``context_revision``; does not commit.

    Issues a single conditional UPDATE (``WHERE context_revision = expected``)
    so a concurrent context change makes it match zero rows and surface as a
    409 instead of silently losing the update. Callers that pass neither
    changes nor a revision bump use this purely to take the optimistic lock
    before mutating membership rows in the same transaction.
    """
    current = await _owned_project(user_id=user_id, project_id=project_id, session=session)
    values = dict(changes)
    values["context_revision"] = (
        ProjectModel.context_revision + 1 if advance_revision else ProjectModel.context_revision
    )
    # A pure lock acquisition must not touch updated_at: pin it to the current
    # value so the column's onupdate default does not bump the audit timestamp.
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
    """Apply a partial metadata/prompt update under the optimistic revision check.

    Only fields that actually differ from the current row are written; a
    ``system_prompt`` change is what advances the context revision (name and
    description edits never do). A stale revision or a name collision yields 409.
    """
    current = await _owned_project(user_id=user_id, project_id=project_id, session=session)
    changes = payload.model_dump(exclude_unset=True, exclude={"expected_context_revision"})
    # Drop no-op fields so the UPDATE (and updated_at) only reflect real edits.
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

    Active runs of affected chats are cancelled first, outside the write transaction,
    because a cancelled run persists its terminal state through its own session.
    """
    from asterism.domains.chat.membership import detach_project_chats, retire_project_chat_runs

    current = await _owned_project(user_id=user_id, project_id=project_id, session=session)
    if current.context_revision != expected_context_revision:
        raise CodedException(409, "Project context changed; reload the project and retry")
    # Cancel in-memory runtime jobs before any row is touched; cancelled runs
    # persist their own terminal state later through separate sessions.
    await retire_project_chat_runs(user_id=user_id, project_id=project_id, session=session)
    try:
        # Lock-only compare-and-set: pins the revision so a concurrent context
        # change between the check above and the DELETE below fails here (409).
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
    """Add (``remove=False``) or remove (``remove=True``) file memberships atomically.

    The batch is idempotent per id: ids already in the desired state are reported
    as unchanged and do not bump the context revision. All-or-nothing — any
    validation failure rolls back the whole transaction, so a stale revision can
    never leave partial memberships behind.
    """
    from asterism.domains.files.service import validate_owned_file_ids

    # Dedupe and order deterministically (UUID string order) for stable results.
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
    """Paginated list of the files currently attached to an owned project.

    Reuses the files domain's listing machinery (sort/search/page semantics);
    this function only contributes the project-membership filter and the
    ownership check. Lazy imports keep the dependency direction one-way.
    """
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
