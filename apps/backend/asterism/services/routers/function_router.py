from fastapi import APIRouter

from asterism.common import ErrorDetail
from asterism.events import Event, EventType, event_bus


@event_bus.on(EventType.TOOL_CREATED)
async def handle_function_create(event: Event):
    print(event)


function_router = APIRouter(
    prefix="/functions",
    tags=["Function"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)
