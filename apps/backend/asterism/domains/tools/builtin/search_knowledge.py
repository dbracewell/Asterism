"""Context-managed retrieval over the current chat/project file ceiling."""

from pydantic import BaseModel, Field
from sqlalchemy import select

from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.domains.chat.scope import resolve_chat_file_scope
from asterism.domains.chat.tool_policy import require_internal_tool
from asterism.domains.extraction.models import FileExtractionModel, FileKnowledgeArtifactStatus
from asterism.domains.extraction.runtime import embedding_provider, vector_store
from asterism.domains.tools.context import ContextToolScope
from asterism.domains.tools.registry import ToolContext, tool_registry


class SearchKnowledgeArgs(BaseModel):
    query: str = Field(min_length=1, max_length=2_000)
    top_k: int = Field(default=5, ge=1, le=100)


def _bounded_excerpt(content: str, remaining_bytes: int) -> str:
    encoded = content.encode("utf-8")[:remaining_bytes]
    return encoded.decode("utf-8", errors="ignore")


async def _read_search_scope(ctx: ToolContext[SearchKnowledgeArgs], scope: ContextToolScope):
    await require_internal_tool(name="search_knowledge", user_id=ctx.user.id, chat_id=ctx.session.info.id, scope=scope)
    async with get_async_db_session() as db:
        live = await resolve_chat_file_scope(user_id=ctx.user.id, chat_id=ctx.session.info.id, session=db)
        ids = scope.file_ids.intersection(live.allowed_file_ids)
        sources = {str(file.file_id): file.sources for file in live.files if file.file_id in ids}
        artifacts = {
            str(artifact.file_id): artifact
            for artifact in await db.scalars(
                select(FileExtractionModel).where(
                    FileExtractionModel.user_id == ctx.user.id,
                    FileExtractionModel.file_id.in_(ids),
                    FileExtractionModel.is_current.is_(True),
                ),
            )
        }
    states = [
        {
            "file_id": str(file_id),
            "status": (
                "unavailable"
                if str(file_id) not in artifacts
                or (
                    artifacts[str(file_id)].status == FileKnowledgeArtifactStatus.READY
                    and not artifacts[str(file_id)].text_embeddings_ready
                )
                else artifacts[str(file_id)].status.value
            ),
        }
        for file_id in sorted(ids, key=str)
    ]
    ready = {
        file_id: artifact
        for file_id, artifact in artifacts.items()
        if artifact.status == FileKnowledgeArtifactStatus.READY and artifact.text_embeddings_ready
    }
    return sources, ready, states


@tool_registry.tool(
    name="search_knowledge",
    description="Search files authorized in the current project and active chat attachments for relevant excerpts.",
)
async def search_knowledge(ctx: ToolContext[SearchKnowledgeArgs]) -> dict[str, object]:
    scope = await require_internal_tool(
        name="search_knowledge", user_id=ctx.user.id, chat_id=ctx.session.info.id, scope=ctx.tool_scope
    )
    if ctx.args.top_k > config.max_knowledge_query_top_k:
        return {"results": [], "message": "Requested result count exceeds the configured limit."}
    sources, artifacts, states = await _read_search_scope(ctx, scope)
    if not sources:
        return {"results": [], "message": "No files are authorized in the current context.", "file_states": states}
    if len(sources) > config.max_knowledge_allowed_files:
        return {"results": [], "message": "Context exceeds the searchable file limit.", "file_states": states}
    if not artifacts:
        return {
            "results": [],
            "message": "No searchable artifacts are ready; files may be pending, failed, or unavailable.",
            "file_states": states,
        }
    try:
        query_vector = (await embedding_provider.embed_text([ctx.args.query]))[0]
        # Revocation during embedding must take effect before any vector query.
        sources, artifacts, states = await _read_search_scope(ctx, scope)
        if not artifacts:
            return {"results": [], "message": "No searchable artifacts remain.", "file_states": states}
        matches = await vector_store.search(
            query_vector, user_id=ctx.user.id, allowed_file_ids=list(artifacts), limit=ctx.args.top_k
        )
    except Exception as error:
        from asterism.core.exceptions import CodedException

        if isinstance(error, CodedException):
            raise
        return {
            "results": [],
            "message": "Retrieval is unavailable; retry when the embedding/vector service is ready.",
            "file_states": states,
        }
    # Never release stale generations or files revoked during vector search.
    sources, artifacts, states = await _read_search_scope(ctx, scope)
    remaining_bytes = config.max_knowledge_result_bytes
    results = []
    for match in matches:
        artifact = artifacts.get(match.file_id)
        if artifact is None or artifact.generation != match.artifact_generation or remaining_bytes <= 0:
            continue
        excerpt = _bounded_excerpt(match.content, remaining_bytes)
        remaining_bytes -= len(excerpt.encode("utf-8"))
        results.append(
            {
                "file_id": match.file_id,
                "sources": sources[match.file_id],
                "artifact_generation": match.artifact_generation,
                "chunk_id": match.id,
                "score": match.score,
                "match_kind": "caption" if artifact.caption_text and match.content == artifact.caption_text else "text",
                "excerpt": excerpt,
            }
        )
    return {"results": results, "count": len(results), "file_states": states}
