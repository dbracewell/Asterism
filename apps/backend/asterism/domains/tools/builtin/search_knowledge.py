"""Built-in, assignment-scoped knowledge retrieval tool."""

from pydantic import BaseModel, Field
from sqlalchemy import select

from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.domains.extraction.models import FileExtractionModel, FileKnowledgeArtifactStatus
from asterism.domains.extraction.runtime import embedding_provider, vector_store
from asterism.domains.knowledge.models import (
    AgentKnowledgeBaseAssignmentModel,
    KnowledgeBaseFileModel,
    KnowledgeBaseModel,
)
from asterism.domains.tools.registry import ToolContext, tool_registry


class SearchKnowledgeArgs(BaseModel):
    query: str = Field(min_length=1, max_length=2_000)
    top_k: int = Field(default=5, ge=1, le=100)


def _bounded_excerpt(content: str, remaining_bytes: int) -> str:
    encoded = content.encode("utf-8")[:remaining_bytes]
    return encoded.decode("utf-8", errors="ignore")


@tool_registry.tool(
    name="search_knowledge",
    description="Search the active agent's assigned private knowledge bases for relevant excerpts.",
)
async def search_knowledge(ctx: ToolContext[SearchKnowledgeArgs]) -> dict[str, object]:
    if ctx.args.top_k > config.max_knowledge_query_top_k:
        return {"results": [], "message": "Requested result count exceeds the configured limit."}
    agent_id = ctx.session.info.agent_id
    if agent_id is None:
        return {"results": [], "message": "Knowledge search is unavailable for this chat."}
    async with get_async_db_session() as db:
        base_ids = list(
            await db.scalars(
                select(AgentKnowledgeBaseAssignmentModel.knowledge_base_id)
                .where(
                    AgentKnowledgeBaseAssignmentModel.user_id == ctx.user.id,
                    AgentKnowledgeBaseAssignmentModel.agent_id == agent_id,
                )
                .order_by(AgentKnowledgeBaseAssignmentModel.position),
            ),
        )
        if not base_ids:
            return {"results": [], "message": "No assigned knowledge bases are available."}
        memberships = list(
            await db.scalars(
                select(KnowledgeBaseFileModel)
                .join(KnowledgeBaseModel, KnowledgeBaseModel.id == KnowledgeBaseFileModel.knowledge_base_id)
                .where(
                    KnowledgeBaseFileModel.knowledge_base_id.in_(base_ids),
                    KnowledgeBaseModel.user_id == ctx.user.id,
                ),
            ),
        )
        # Resolve authorization before querying the vector store.  A file that
        # belongs to more than one assigned base has one canonical vector but
        # retains a deterministic collection provenance for this response.
        base_by_file = {str(membership.file_id): str(membership.knowledge_base_id) for membership in memberships}
        if not base_by_file:
            return {"results": [], "message": "Assigned knowledge bases have no files."}
        if len(base_by_file) > config.max_knowledge_allowed_files:
            return {"results": [], "message": "Assigned knowledge bases exceed the searchable file limit."}
        query_vector = (await embedding_provider.embed_text([ctx.args.query]))[0]
        matches = await vector_store.search(
            query_vector,
            user_id=ctx.user.id,
            allowed_file_ids=list(base_by_file),
            limit=ctx.args.top_k,
        )
        ready_artifacts = {
            (str(artifact.file_id), artifact.generation): artifact
            for artifact in await db.scalars(
                select(FileExtractionModel).where(
                    FileExtractionModel.user_id == ctx.user.id,
                    FileExtractionModel.file_id.in_([membership.file_id for membership in memberships]),
                    FileExtractionModel.is_current.is_(True),
                    FileExtractionModel.status == FileKnowledgeArtifactStatus.READY,
                ),
            )
        }
    remaining_bytes = config.max_knowledge_result_bytes
    results = []
    for match in matches:
        artifact = ready_artifacts.get((match.file_id, match.artifact_generation))
        if artifact is None or remaining_bytes <= 0:
            continue
        match_kind = "caption" if artifact.caption_text and match.content == artifact.caption_text else "text"
        excerpt = _bounded_excerpt(match.content, remaining_bytes)
        remaining_bytes -= len(excerpt.encode("utf-8"))
        results.append(
            {
                "knowledge_base_id": base_by_file[match.file_id],
                "file_id": match.file_id,
                "artifact_generation": match.artifact_generation,
                "chunk_id": match.id,
                "score": match.score,
                "match_kind": match_kind,
                "excerpt": excerpt,
            },
        )
    return {"results": results, "count": len(results)}
