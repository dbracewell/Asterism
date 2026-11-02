"""Runtime composition root for contextual retrieval with live policy readers."""

import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core import config
from asterism.core.exceptions import BadDataException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.execution_scope import ExecutionScope, FileProvenance
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel
from asterism.domains.knowledge.queries import select_current_owned_artifacts
from asterism.domains.knowledge.runtime import embedding_provider, vector_store
from asterism.domains.retrieval.service import RetrievalArtifact, RetrievalLimits, RetrievalService, RetrievalSnapshot
from asterism.domains.settings.tool_settings import get_tool_settings
from asterism.domains.tools.context import ContextToolScope

from .runtime_files import read_execution_files
from .scope import resolve_chat_file_scope
from .tool_policy import require_internal_tool


def create_retrieval_service(
    *,
    ceiling: ContextToolScope | None,
    check_active: Callable[[], Awaitable[None]] | None = None,
) -> RetrievalService:
    async def read(scope: ExecutionScope) -> RetrievalSnapshot:
        await require_internal_tool(
            name="search_knowledge", user_id=scope.user_id, chat_id=scope.chat_id, scope=ceiling
        )
        authorized = await read_execution_files(scope, ceiling=ceiling, check_active=check_active)
        async with get_async_db_session() as db:
            artifacts = await _read_artifacts(scope.user_id, [file.file_id for file in authorized.files], db)
        return RetrievalSnapshot(authorized.files, artifacts, authorized.context_revision)

    return _service(read)


def create_verification_retrieval_service() -> RetrievalService:
    """Retrieval for a verify pass (ADR-0041).

    There is no running agent to reauthorize, so every read rechecks the admin
    policy for ``search_knowledge`` and the chat's live file scope, and keeps
    only files inside the scope's ceiling: the answer's recorded files,
    narrowed by the request.
    """

    async def read(scope: ExecutionScope) -> RetrievalSnapshot:
        async with get_async_db_session() as db:
            if "search_knowledge" not in (await get_tool_settings(db)).active_tools:
                raise BadDataException("Knowledge search is turned off")
            live = await resolve_chat_file_scope(user_id=scope.user_id, chat_id=scope.chat_id, session=db)
            if live.project_id != scope.project_id:
                raise BadDataException("The chat's project changed")
            files = tuple(
                FileProvenance(file.file_id, tuple(file.sources), tuple(file.message_ids))
                for file in live.files
                if file.file_id in scope.allowed_file_ids
            )
            artifacts = await _read_artifacts(scope.user_id, [file.file_id for file in files], db)
        return RetrievalSnapshot(files, artifacts, live.project_context_revision)

    return _service(read)


async def _read_artifacts(user_id: str, file_ids: list[uuid.UUID], db: AsyncSession) -> tuple[RetrievalArtifact, ...]:
    return tuple(
        RetrievalArtifact(
            file_id=artifact.file_id,
            generation=artifact.generation,
            status=artifact.status,
            searchable=artifact.searchable,
        )
        for artifact in await db.scalars(
            select_current_owned_artifacts(user_id).where(FileKnowledgeArtifactModel.file_id.in_(file_ids))
        )
    )


def _service(read: Callable[[ExecutionScope], Awaitable[RetrievalSnapshot]]) -> RetrievalService:
    return RetrievalService(
        read_scope=read,
        embeddings=embedding_provider,
        vectors=vector_store,
        limits=RetrievalLimits(
            config.max_knowledge_query_top_k, config.max_knowledge_allowed_files, config.max_knowledge_result_bytes
        ),
    )
