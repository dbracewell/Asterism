"""Runtime composition root for contextual retrieval with live policy readers."""

from collections.abc import Awaitable, Callable

from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.domains.agent.execution_scope import ExecutionScope
from asterism.domains.extraction.models import FileExtractionModel
from asterism.domains.extraction.queries import select_current_owned_artifacts
from asterism.domains.extraction.runtime import embedding_provider, vector_store
from asterism.domains.retrieval.service import RetrievalArtifact, RetrievalLimits, RetrievalService, RetrievalSnapshot
from asterism.domains.tools.context import ContextToolScope

from .runtime_files import read_execution_files
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
        ids = [file.file_id for file in authorized.files]
        async with get_async_db_session() as db:
            artifacts = tuple(
                RetrievalArtifact(
                    file_id=artifact.file_id,
                    generation=artifact.generation,
                    status=artifact.status,
                    text_embeddings_ready=artifact.text_embeddings_ready,
                )
                for artifact in await db.scalars(
                    select_current_owned_artifacts(scope.user_id).where(FileExtractionModel.file_id.in_(ids))
                )
            )
        return RetrievalSnapshot(authorized.files, artifacts, authorized.context_revision)

    return RetrievalService(
        read_scope=read,
        embeddings=embedding_provider,
        vectors=vector_store,
        limits=RetrievalLimits(
            config.max_knowledge_query_top_k, config.max_knowledge_allowed_files, config.max_knowledge_result_bytes
        ),
    )
