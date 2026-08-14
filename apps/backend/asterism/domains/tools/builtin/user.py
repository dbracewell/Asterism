from asterism.core.schemas import NoArgs
from asterism.domains.tools.registry import ToolContext, tool_registry


@tool_registry.tool(
    name="get_user_name",
    description="Get's the user's name.",
)
def get_user_name(ctx: ToolContext[NoArgs]) -> str:
    return ctx.user.name
