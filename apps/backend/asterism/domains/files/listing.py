"""Execute composed file queries and enrich only the returned page."""

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.db.queries import paginate_select

from .models import UserFileModel
from .schemas import UserFile, UserFileList


async def describe_files(*, user_id: str, files: list[UserFileModel], session: AsyncSession) -> list[UserFile]:
    from asterism.domains.projects.file_references import file_project_summaries

    summaries = await file_project_summaries(user_id=user_id, file_ids=[file.id for file in files], session=session)
    return [UserFile.model_validate(file).model_copy(update={"projects": summaries.get(file.id, [])}) for file in files]


async def list_file_page(
    *,
    user_id: str,
    statement: Select[tuple[UserFileModel]],
    session: AsyncSession,
    page: int = 1,
    page_size: int = 50,
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
    return UserFileList(files=files, total=result.total, page=result.page, page_size=result.page_size)
