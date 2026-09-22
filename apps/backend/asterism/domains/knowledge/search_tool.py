"""Built-in, assignment-scoped knowledge retrieval tool."""

import hashlib
import time
import uuid

from pydantic import BaseModel, Field
from sqlalchemy import select

from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.domains.tools.registry import ToolContext, tool_registry

from .assignments import AgentKnowledgeBaseAssignmentModel
from .audit import record_knowledge_audit
from .models import KnowledgeCaptionStatus, KnowledgeDocumentModel, KnowledgeDocumentStatus
from .runtime import embedding_provider, vector_store


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
    started_at = time.monotonic()
    async with get_async_db_session() as db:
        base_ids = list(
            await db.scalars(
                select(AgentKnowledgeBaseAssignmentModel.knowledge_base_id)
                .where(
                    AgentKnowledgeBaseAssignmentModel.user_id == ctx.user.id,
                    AgentKnowledgeBaseAssignmentModel.agent_id == agent_id,
                )
                .order_by(AgentKnowledgeBaseAssignmentModel.position)
            )
        )
        if not base_ids:
            return {"results": [], "message": "No assigned knowledge bases are available."}
        query_vector = (await embedding_provider.embed_text([ctx.args.query]))[0]
        matches = await vector_store.search(
            query_vector,
            user_id=ctx.user.id,
            knowledge_base_ids=[str(base_id) for base_id in base_ids],
            limit=ctx.args.top_k,
        )
        # LanceDB stores provenance IDs as strings, whereas relational IDs are
        # UUID columns. Convert at the adapter boundary before binding SQL.
        document_ids: list[uuid.UUID] = []
        for match in matches:
            try:
                document_ids.append(uuid.UUID(str(match.document_id)))
            except ValueError:
                # A malformed/stale vector cannot be associated with a ready
                # document and must never become a retrieval result.
                continue
        ready_documents: dict[str, KnowledgeDocumentModel] = {}
        if document_ids:
            documents = await db.scalars(
                select(KnowledgeDocumentModel).where(
                    KnowledgeDocumentModel.user_id == ctx.user.id,
                    KnowledgeDocumentModel.id.in_(document_ids),
                    KnowledgeDocumentModel.status == KnowledgeDocumentStatus.READY,
                )
            )
            ready_documents = {str(document.id): document for document in documents}
        db.add(
            record_knowledge_audit(
                user_id=ctx.user.id,
                action="search.executed",
                details={
                    "agent_id": str(agent_id),
                    "assigned_base_count": len(base_ids),
                    "result_count": len(matches),
                    "duration_ms": int((time.monotonic() - started_at) * 1_000),
                },
            )
        )
        await db.commit()
    remaining_bytes = config.max_knowledge_result_bytes
    results = []
    for match in matches:
        document = ready_documents.get(str(match.document_id))
        if document is None or remaining_bytes <= 0:
            continue
        caption_chunk_id = hashlib.sha256(f"{document.id}:{document.revision}:caption".encode()).hexdigest()
        if match.id == caption_chunk_id and document.caption_status is KnowledgeCaptionStatus.ACCEPTED:
            match_kind = "accepted_caption"
        elif document.mime_type.startswith("image/"):
            match_kind = "visual_image"
        else:
            match_kind = "text"
        excerpt = _bounded_excerpt(match.content, remaining_bytes)
        remaining_bytes -= len(excerpt.encode("utf-8"))
        results.append(
            {
                "knowledge_base_id": match.knowledge_base_id,
                "document_id": match.document_id,
                "revision_id": match.revision_id,
                "chunk_id": match.id,
                "score": match.score,
                "match_kind": match_kind,
                "excerpt": excerpt,
            }
        )
    return {"results": results, "count": len(results)}
