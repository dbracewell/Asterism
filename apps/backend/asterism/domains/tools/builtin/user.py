"""Small tools exposing facts about the calling user."""

from asterism.core.schemas import NoArgs
from asterism.domains.tools.registry import ToolContext, tool_registry


@tool_registry.tool(
    name="get_user_name",
    description="Gets the user's name.",
)
def get_user_name(ctx: ToolContext[NoArgs]) -> str:
    """Return the authenticated user's display name."""
    return ctx.user.name
