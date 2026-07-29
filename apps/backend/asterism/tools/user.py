from asterism.common import NoArgs
from asterism.registries.tool import ToolContext, tool_registry


@tool_registry.tool(
    name="get_user_name",
    description="Get's the user's name they used when signing up. "
    "Only use this if there are no memories of what the user likes to be "
    "called.",
)
def get_user_name(ctx: ToolContext[NoArgs]) -> str:
    return ctx.user.name
