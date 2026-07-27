from asterism.core.registries.tool import tool_registry
from asterism.core.typedefs import AuthedUser


@tool_registry.tool(
    name="get_user_name",
    description="Get's the user's name they used when signing up. "
    "Only use this if there are no memories of what the user likes to be called.",
)
def get_user_name(user: AuthedUser) -> str:
    return user.name
