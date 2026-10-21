"""Execute composed file queries and enrich only the returned page.

Enrichment (project memberships and knowledge artifacts) is deliberately
scoped to the page that was actually returned: a listing of 50 files must not
trigger joins or lookups for the thousands of files behind it.
"""

import uuid

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.db.queries import paginate_select
from asterism.domains.extraction.queries import select_file_artifacts
from asterism.domains.extraction.schemas import FileKnowledgeArtifact

from .models import UserFileModel
from .schemas import UserFile, UserFileList


async def file_knowledge_summaries(
    *,
    file_ids: list[uuid.UUID],
    session: AsyncSession,
) -> dict[uuid.UUID, FileKnowledgeArtifact]:
    """Map each file to the artifact generation that represents its knowledge.

    The *current* generation wins: it is the one retrieval serves, so the UI
    and retrieval agree on which generation a file is using. A file that has
    never been processed has no current generation yet, so its newest
    generation is reported instead — that is the one still being built.

    Args:
        file_ids: Files to look up. An empty list returns an empty mapping.
        session: Active async session; no commit happens here.

    Returns:
        A mapping of file id to its representative artifact. Files without any
        artifact are absent from the mapping.
    """
    if not file_ids:
        return {}
    artifacts = (await session.scalars(select_file_artifacts(file_ids))).all()
    current: dict[uuid.UUID, FileKnowledgeArtifact] = {}
    newest: dict[uuid.UUID, FileKnowledgeArtifact] = {}
    for artifact in artifacts:
        described = FileKnowledgeArtifact.model_validate(artifact)
        # The select orders by descending generation, so the first artifact
        # seen for a file is its newest generation.
        newest.setdefault(artifact.file_id, described)
        if artifact.is_current:
            current[artifact.file_id] = described
    summaries: dict[uuid.UUID, FileKnowledgeArtifact] = {}
    for file_id, artifact in newest.items():
        summaries[file_id] = current[file_id] if file_id in current else artifact
    return summaries


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
    return [
        UserFile.model_validate(file).model_copy(
            update={
                "projects": summaries.get(file.id, []),
                "knowledge": knowledge_map.get(file.id),
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
