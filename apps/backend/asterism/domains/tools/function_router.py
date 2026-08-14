from fastapi import APIRouter

from asterism.common.log import DEFAULT_LOGGER
from asterism.core.events import Event, EventType, event_bus
from asterism.core.schemas import ErrorDetail


@event_bus.on(EventType.TOOL_CREATED)
async def handle_function_create(event: Event):
    DEFAULT_LOGGER.info(event)


function_router = APIRouter(
    prefix="/functions",
    tags=["Function"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)
