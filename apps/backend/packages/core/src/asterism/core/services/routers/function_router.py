from contextlib import asynccontextmanager

from fastapi import APIRouter

from asterism.core.data.schemas import ErrorDetail
from asterism.core.events.bus import event_bus
from asterism.core.events.typedefs import Event, EventType
from asterism.core.services.loaders.tool_loader import load_tools


async def handle_function_create(event: Event):
    print(event)


@asynccontextmanager
async def lifespan(router: APIRouter):
    await load_tools()
    event_bus.on(EventType.TOOL_CREATED, handle_function_create)
    yield


function_router = APIRouter(
    lifespan=lifespan,
    prefix="/functions",
    tags=["Function"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)
