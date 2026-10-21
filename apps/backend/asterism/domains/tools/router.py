"""HTTP endpoints exposing the tool catalog to the frontend.

``GET /tools/active`` serves any authenticated user the tools that are both
registered and enabled by admin policy (internal tools excluded).
``GET /tools/all`` is admin-only and lists every registered tool regardless of
policy, so admins can see what they may toggle.
"""

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.domains.settings.service import get_app_settings
from asterism.domains.tools.registry import tool_registry
from asterism.domains.tools.schemas import ToolInfoList
from asterism.domains.user.dependencies import AdminUserDep, AuthedUserDep

tools_router = APIRouter(
    prefix="/tools",
    tags=["Function"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@tools_router.get(
    "/active",
    response_model=ToolInfoList,
    operation_id="toolsGetActive",
    summary="Get all active tools",
)
async def get_active_tools(_: AuthedUserDep) -> ToolInfoList:
    """Return the user-configurable tools currently enabled by admin policy."""
    return tool_registry.active_tools(await get_app_settings())


@tools_router.get(
    "/all",
    response_model=ToolInfoList,
    operation_id="toolsGetAll",
    summary="Get all tools",
)
async def get_all_tools(_: AdminUserDep) -> ToolInfoList:
    """Return every registered tool (admin-only), including internal ones."""
    return tool_registry.tools()
