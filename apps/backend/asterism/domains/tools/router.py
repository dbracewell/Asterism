from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
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
    return await tool_registry.active_tools()


@tools_router.get(
    "/all",
    response_model=ToolInfoList,
    operation_id="toolsGetAll",
    summary="Get all  tools",
)
async def get_all_tools(_: AdminUserDep) -> ToolInfoList:
    return tool_registry.tools()
