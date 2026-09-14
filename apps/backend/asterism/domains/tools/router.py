from fastapi import APIRouter

from asterism.common.log import DEFAULT_LOGGER
from asterism.core.events import Event, EventType, event_bus
from asterism.core.schemas import ErrorDetail
from asterism.domains.tools.registry import tool_registry
from asterism.domains.tools.schemas import ToolInfoList
from asterism.domains.user.dependencies import AuthedUserDep


@event_bus.on(EventType.TOOL_CREATED)
async def handle_function_create(event: Event):
    DEFAULT_LOGGER.info(event)


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
async def get_all_tools(_: AuthedUserDep) -> ToolInfoList:
    return tool_registry.tools()
