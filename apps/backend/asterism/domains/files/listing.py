"""Reads of a user's files: listing pages, single files and ownership checks.

Every lookup is scoped by ``user_id``. Enrichment (project memberships and
knowledge artifacts) is deliberately scoped to the page that was actually
returned: a listing of 50 files must not trigger joins or lookups for the
thousands of files behind it.
"""

import uuid
from typing import Literal

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import NotFoundException
from asterism.db.database import get_async_db_session
from asterism.db.queries import paginate_select
from asterism.domains.courses.locks import managed_records
from asterism.domains.knowledge.artifacts import (
    reported_artifacts,
)
from asterism.domains.knowledge.schemas import FileKnowledgeArtifact

from .models import UserFileModel
from .processor import ensure_file_processed as ensure_file_processed
from .queries import (
    select_file_by_name,
    select_files_by_ids,
    select_owned_file_ids,
    select_owned_files,
)
from .schemas import UserFile, UserFileList
from .store import get_file_store as get_file_store


async def file_knowledge_summaries(
    *,
    file_ids: list[uuid.UUID],
    session: AsyncSession,
) -> dict[uuid.UUID, FileKnowledgeArtifact]:
    """Map each file to the artifact generation that represents its knowledge.

    The knowledge domain owns that choice: it reports the current generation
    when one exists, and the newest generation otherwise.

    Args:
        file_ids: Files to look up. An empty list returns an empty mapping.
        session: Active async session; no commit happens here.

    Returns:
        A mapping of file id to its representative artifact. Files without any
        artifact are absent from the mapping.
    """
    return await reported_artifacts(file_ids=file_ids, session=session)


async def describe_files(*, user_id: str, files: list[UserFileModel], session: AsyncSession) -> list[UserFile]:
    """Convert file rows into their public representation, enriched with context.

    Args:
        user_id: Owner of the files; used to scope the project-membership
            lookup so foreign project links are never disclosed.
        files: Rows to describe. Order is preserved.
        session: Active async session; no commit happens here.

    Returns:
        One :class:`UserFile` per input row, in the same order.
    """
    from asterism.domains.projects.file_references import file_project_summaries

    file_ids = [file.id for file in files]
    summaries = await file_project_summaries(user_id=user_id, file_ids=file_ids, session=session)
    knowledge_map = await file_knowledge_summaries(file_ids=file_ids, session=session)
    managed = await managed_records(user_id, file_ids, session)
    return [
        UserFile.model_validate(file).model_copy(
            update={
                "projects": summaries.get(file.id, []),
                "knowledge": knowledge_map.get(file.id),
                "managed_by_class": managed.get(file.id),
            }
        )
        for file in files
    ]


async def list_file_page(
    *,
    user_id: str,
    statement: Select[tuple[UserFileModel]],
    session: AsyncSession,
    page: int = 1,
    page_size: int = 50,
) -> UserFileList:
    """Execute a composed file statement and return one enriched page.

    Args:
        user_id: Owner whose files may be returned.
        statement: A composed select over :class:`UserFileModel`. It may
            carry extra filters (for example project membership); extra
            ordering is preserved but does not affect the total count.
        session: Active async session; no commit happens here.
        page: 1-based page number.
        page_size: Rows per page (1..100).

    Returns:
        A :class:`UserFileList` with the page's files, the total number of
        matching rows, and the applied pagination values.

    Raises:
        BadDataException: If ``page`` or ``page_size`` is out of bounds.
    """
    # Enforce owner scope at the execution boundary too, even if a caller omitted
    # the base builder or broadened its filters. Workspace scope remains caller-owned.
    result = await paginate_select(
        statement=statement.where(UserFileModel.user_id == user_id),
        session=session,
        page=page,
        page_size=page_size,
    )
    files = await describe_files(user_id=user_id, files=result.records, session=session)
    return UserFileList(files=files, total=result.total, page=result.page, page_size=result.page_size)


async def get_user_file_info(
    user_id: str,
    filename: str,
    session: AsyncSession | None = None,
) -> UserFile:
    """Get metadata for one of the caller's files.

    Args:
        user_id: Owner of the file.
        filename: Display name of the file.
        session: Optional existing session to reuse; a new one is opened when
            omitted.

    Returns:
        The file's metadata, including project and knowledge context.

    Raises:
        NotFoundException: If the file does not exist.
    """
    async with get_async_db_session(session) as session:
        file = await session.scalar(select_file_by_name(user_id=user_id, filename=filename))
        if file is None:
            raise NotFoundException("File does not exist")

        return (await describe_files(user_id=user_id, files=[file], session=session))[0]


async def list_user_files(
    *,
    user_id: str,
    session: AsyncSession,
    page: int = 1,
    page_size: int = 50,
    sort_by: Literal["name", "kind", "date", "size"] = "name",
    query: str | None = None,
) -> UserFileList:
    """List the caller's files.

    Args:
        user_id: Owner whose files are listed.
        session: Active async session; no commit happens here.
        page: 1-based page number.
        page_size: Rows per page (1..100).
        sort_by: Primary ordering key.
        query: Optional case-insensitive substring filter on the file name.

    Returns:
        One page of the caller's files with project and knowledge context.
    """
    statement = select_owned_files(user_id=user_id, query=query, sort_by=sort_by)
    return await list_file_page(
        user_id=user_id,
        statement=statement,
        session=session,
        page=page,
        page_size=page_size,
    )


async def _owned_file(*, user_id: str, filename: str, session: AsyncSession) -> UserFileModel:
    """Load one of the caller's files by its display name.

    Args:
        user_id: Owner of the file.
        filename: Display name of the file.
        session: Active async session; no commit happens here.

    Returns:
        The matching file row.

    Raises:
        NotFoundException: If the caller owns no file with that name.
    """
    file = await session.scalar(select_file_by_name(user_id=user_id, filename=filename))
    if file is None:
        raise NotFoundException("File not found")
    return file


async def validate_owned_file_ids(*, user_id: str, file_ids: list[uuid.UUID], session: AsyncSession) -> None:
    """Assert that every given file id belongs to the caller.

    Args:
        user_id: Owner the files must belong to.
        file_ids: File ids to validate.
        session: Active async session; no commit happens here.

    Raises:
        NotFoundException: If any id is not owned by the caller.
    """
    owned = set(
        await session.scalars(select_owned_file_ids(user_id=user_id, file_ids=file_ids)),
    )
    if owned != set(file_ids):
        raise NotFoundException("File not found")


async def get_file_info_by_id(*, user_id: str, file_id: uuid.UUID, session: AsyncSession) -> UserFile:
    """Get metadata for one of the caller's files by its id.

    Args:
        user_id: Owner of the file.
        file_id: Identifier of the file.
        session: Active async session; no commit happens here.

    Returns:
        The file's metadata, including project and knowledge context.

    Raises:
        NotFoundException: If the caller owns no file with that id.
    """
    file = await session.scalar(select_files_by_ids(user_id=user_id, file_ids=[file_id]))
    if file is None:
        raise NotFoundException("File not found")
    return (await describe_files(user_id=user_id, files=[file], session=session))[0]
