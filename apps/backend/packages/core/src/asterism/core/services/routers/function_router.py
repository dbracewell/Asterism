from contextlib import asynccontextmanager

from fastapi import APIRouter

from asterism.core.events import Event, EventType, event_bus
from asterism.core.exceptions import ErrorDetail


async def handle_function_create(event: Event):
    print(event)


@asynccontextmanager
async def lifespan(_: APIRouter):
    event_bus.on(EventType.TOOL_CREATED, handle_function_create)
    yield


function_router = APIRouter(
    lifespan=lifespan,
    prefix="/functions",
    tags=["Function"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)
