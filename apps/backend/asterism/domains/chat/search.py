"""Owner-scoped indexed search, database pagination, and page-only enrichment."""

import re
import uuid
from typing import Literal

from sqlalchemy import func, literal, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException
from asterism.db.database import get_async_db_session
from asterism.domains.projects.models import ProjectModel
from asterism.domains.projects.queries import select_owned_projects
from asterism.domains.projects.scope import require_owned_project

from .models import ChatModel
from .queries import select_owned_chats, select_owned_message_snippets
from .schemas import SearchMatchSource, SearchResult, SearchResultKind, SearchResultList
from .search_index import ChatSearchIndex, search_index_for

SearchScope = Literal["all", "general", "project"]


def _snippet(content: str, terms: list[str], limit: int = 180) -> str:
    normalized = content.replace("\n", " ").strip()
    position = min((normalized.casefold().find(term) for term in terms if term in normalized.casefold()), default=0)
    start = max(0, position - 50)
    end = min(len(normalized), start + limit)
    return f"{'…' if start else ''}{normalized[start:end]}{'…' if end < len(normalized) else ''}"


async def search(
    user_id: str,
    query: str,
    page: int = 1,
    page_size: int = 20,
    session: AsyncSession | None = None,
    *,
    scope: SearchScope = "all",
    project_id: uuid.UUID | None = None,
) -> SearchResultList:
    if page < 1 or not 1 <= page_size <= 100:
        raise BadDataException("Invalid pagination")
    if scope not in ("all", "general", "project") or (scope == "project") != (project_id is not None):
        raise BadDataException("Project search requires a project ID; other scopes must omit it")
    terms = re.findall(r"[\w]+", query.casefold())[:10]
    async with get_async_db_session(session) as session:
        if project_id is not None:
            await require_owned_project(user_id=user_id, project_id=project_id, session=session)
        if not terms:
            return SearchResultList(results=[], total=0, page=page, page_size=page_size)
        matches = _select_matches(
            user_id=user_id,
            index=search_index_for(session),
            terms=terms,
            scope=scope,
            project_id=project_id,
        )
        total = await session.scalar(select(func.count()).select_from(matches))
        rows = (
            await session.execute(
                select(matches)
                .order_by(
                    matches.c.updated_at.desc(),
                    matches.c.kind.asc(),
                    matches.c.id.asc(),
                )
                .offset((page - 1) * page_size)
                .limit(page_size),
            )
        ).all()
        results = await _enrich_page(user_id=user_id, rows=rows, terms=terms, session=session)
        return SearchResultList(results=results, total=total or 0, page=page, page_size=page_size)


def _select_matches(
    *,
    user_id: str,
    index: ChatSearchIndex,
    terms: list[str],
    scope: SearchScope,
    project_id: uuid.UUID | None,
):
    chats = (
        select_owned_chats(user_id=user_id)
        .order_by(None)
        .where(
            ChatModel.id.in_(index.matching_chats(user_id, terms)),
        )
    )
    if scope != "all":
        chats = chats.where(ChatModel.project_id == project_id)
    chat_matches = chats.with_only_columns(ChatModel.id, ChatModel.updated_at, literal("chat").label("kind"))
    if scope != "all":
        return chat_matches.subquery()
    projects = select_owned_projects(user_id=user_id).where(
        ProjectModel.id.in_(index.matching_projects(user_id, terms)),
    )
    return union_all(
        chat_matches,
        projects.with_only_columns(ProjectModel.id, ProjectModel.updated_at, literal("project").label("kind")),
    ).subquery()


async def _enrich_page(*, user_id: str, rows, terms: list[str], session: AsyncSession) -> list[SearchResult]:
    if not rows:
        return []
    chat_ids = [row.id for row in rows if row.kind == "chat"]
    page_chats: dict[uuid.UUID, ChatModel] = {}
    if chat_ids:
        page_chats = {
            chat.id: chat
            for chat in await session.scalars(select_owned_chats(user_id=user_id).where(ChatModel.id.in_(chat_ids)))
        }
    metadata_ids = {chat.project_id for chat in page_chats.values() if chat.project_id is not None}
    metadata_ids.update(row.id for row in rows if row.kind == "project")
    page_projects: dict[uuid.UUID, ProjectModel] = {}
    if metadata_ids:
        page_projects = {
            project.id: project
            for project in await session.scalars(
                select_owned_projects(user_id=user_id).where(ProjectModel.id.in_(metadata_ids)),
            )
        }
    content_ids = [
        chat.id
        for chat in page_chats.values()
        if not all(term in (chat.title or "Untitled chat").casefold() for term in terms)
    ]
    snippets: dict[uuid.UUID, str] = {}
    if content_ids:
        snippet_rows = await session.execute(
            select_owned_message_snippets(user_id=user_id, chat_ids=content_ids, terms=terms),
        )
        snippets = {chat_id: content for chat_id, content in snippet_rows}
    results = []
    for row in rows:
        if row.kind == "project":
            project = page_projects[row.id]
            name_match = all(term in project.name.casefold() for term in terms)
            results.append(
                SearchResult(
                    kind=SearchResultKind.PROJECT,
                    id=project.id,
                    title=project.name,
                    updated_at=project.updated_at,
                    project_id=project.id,
                    project_name=project.name,
                    match_source=(
                        SearchMatchSource.PROJECT_NAME if name_match else SearchMatchSource.PROJECT_DESCRIPTION
                    ),
                    snippet=project.name if name_match else _snippet(project.description, terms),
                ),
            )
            continue
        chat = page_chats[row.id]
        title = chat.title or "Untitled chat"
        title_match = all(term in title.casefold() for term in terms)
        project = page_projects.get(chat.project_id)
        results.append(
            SearchResult(
                kind=SearchResultKind.CHAT,
                id=chat.id,
                title=title,
                updated_at=chat.updated_at,
                project_id=chat.project_id,
                project_name=project.name if project else None,
                match_source=SearchMatchSource.TITLE if title_match else SearchMatchSource.CONTENT,
                snippet=title if title_match else _snippet(snippets.get(chat.id, ""), terms),
            ),
        )
    return results
