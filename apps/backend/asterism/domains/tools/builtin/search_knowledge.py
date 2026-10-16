"""Thin context-managed tool adapter for the injected retrieval service."""

from pydantic import BaseModel, Field

from asterism.core.exceptions import BadDataException
from asterism.domains.tools.registry import ToolContext, tool_registry


class SearchKnowledgeArgs(BaseModel):
    query: str = Field(min_length=1, max_length=2_000)
    top_k: int = Field(default=5, ge=1, le=100)


@tool_registry.tool(
    name="search_knowledge",
    description="Search files authorized in the current project and active chat attachments for relevant excerpts.",
)
async def search_knowledge(ctx: ToolContext[SearchKnowledgeArgs]) -> dict[str, object]:
    if ctx.retrieval_service is None or ctx.execution_scope is None:
        raise BadDataException("Retrieval is unavailable without a server-derived execution scope")
    if ctx.execution_scope.user_id != ctx.user.id or ctx.execution_scope.chat_id != ctx.session.info.id:
        raise BadDataException("Invalid retrieval execution identity")
    response = await ctx.retrieval_service.search(ctx.execution_scope, query=ctx.args.query, top_k=ctx.args.top_k)
    return response.model_dump(mode="json", exclude_none=True)
