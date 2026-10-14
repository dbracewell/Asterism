"""Execute composed file queries and enrich only the returned page."""

import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.db.queries import paginate_select

from .models import UserFileModel
from .schemas import UserFile, UserFileList


async def describe_files(*, user_id: str, files: list[UserFileModel], session: AsyncSession) -> list[UserFile]:
    from asterism.domains.projects.file_references import file_project_summaries

    summaries = await file_project_summaries(user_id=user_id, file_ids=[file.id for file in files], session=session)
    return [UserFile.model_validate(file).model_copy(update={"projects": summaries.get(file.id, [])}) for file in files]


async def _describe_knowledge_memberships(
    *,
    files: list[UserFile],
    session: AsyncSession,
    check_knowledge_base_id: uuid.UUID | None,
) -> None:
    from asterism.domains.knowledge_base.models import KnowledgeBaseFileModel

    ids = [file.id for file in files]
    membership = await session.execute(
        select(KnowledgeBaseFileModel.file_id, func.count())
        .where(KnowledgeBaseFileModel.file_id.in_(ids))
        .group_by(KnowledgeBaseFileModel.file_id),
    )
    counts = {file_id: count for file_id, count in membership.all()}
    checked: set[uuid.UUID] = set()
    if check_knowledge_base_id is not None:
        checked = set(
            await session.scalars(
                select(KnowledgeBaseFileModel.file_id).where(
                    KnowledgeBaseFileModel.knowledge_base_id == check_knowledge_base_id,
                    KnowledgeBaseFileModel.file_id.in_(ids),
                ),
            ),
        )
    for file in files:
        file.knowledge_base_count = counts.get(file.id, 0)
        file.in_checked_knowledge_base = file.id in checked


async def list_file_page(
    *,
    user_id: str,
    statement: Select[tuple[UserFileModel]],
    session: AsyncSession,
    page: int = 1,
    page_size: int = 50,
    check_knowledge_base_id: uuid.UUID | None = None,
) -> UserFileList:
    # Enforce owner scope at the execution boundary too, even if a caller omitted
    # the base builder or broadened its filters. Workspace scope remains caller-owned.
    result = await paginate_select(
        statement=statement.where(UserFileModel.user_id == user_id),
        session=session,
        page=page,
        page_size=page_size,
    )
    files = await describe_files(user_id=user_id, files=result.records, session=session)
    await _describe_knowledge_memberships(files=files, session=session, check_knowledge_base_id=check_knowledge_base_id)
    return UserFileList(files=files, total=result.total, page=result.page, page_size=result.page_size)
