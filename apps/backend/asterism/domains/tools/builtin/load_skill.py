"""load_skill: a sub-agent loads one of its own assigned skills (ADR-0062).

Context-managed: the server offers it only to a sub-agent with assigned skills
while the Skills policy is on and its model supports tools. The calling agent
comes from the server-derived tool scope, never from model input, and every
call rechecks the policy and the assignment.
"""

from pydantic import BaseModel, Field

from asterism.core.exceptions import BadDataException
from asterism.domains.tools.catalog import SKILL_TOOL_NAME
from asterism.domains.tools.registry import ToolContext, tool_registry


class LoadSkillArgs(BaseModel):
    """Arguments for load_skill."""

    name: str = Field(min_length=1, max_length=64, description="Name of a skill from your skill catalog.")


@tool_registry.tool(
    name=SKILL_TOOL_NAME,
    description=(
        "Load the full instructions of one skill from your skill catalog. "
        "Load a skill when its description fits the task, then follow its instructions."
    ),
)
async def load_skill(ctx: ToolContext[LoadSkillArgs]) -> dict[str, object]:
    """Return the current instructions of an assigned skill (internal, context-managed)."""
    from asterism.db.database import get_async_db_session
    from asterism.domains.skills.loading import load_assigned_skill

    scope = ctx.tool_scope
    if scope is None or scope.user_id != ctx.user.id or scope.chat_id != ctx.session.info.id:
        raise BadDataException("Skills are unavailable without a server-derived execution scope")
    async with get_async_db_session() as session:
        row = await load_assigned_skill(ctx.user.id, scope.caller_agent_id, ctx.args.name, session)
        return {
            "skill_id": str(row.id),
            "name": row.name,
            "revision": row.revision,
            "instructions": row.content,
        }
