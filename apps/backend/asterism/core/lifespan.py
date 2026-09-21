from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from asterism.common.log import get_logger
from asterism.common.package_walker import load_decorators
from asterism.core import config
from asterism.db.database import db_session_manager
from asterism.domains.chat.jobs import chat_jobs
from asterism.domains.llm.draft import get_draft_model
from asterism.domains.tools.registry import tool_registry

from .events import EventType, NoArgEvent, event_bus

logger = get_logger("ASTERISM")


async def init_system() -> None:
    config.validate_runtime()
    config.prepare_storage()
    get_draft_model()
    db_session_manager.init()
    logger.info("Database session manager initialized.")
    logger.info("Loading tools and components...")
    load_decorators(
        str(Path(__file__).parent.parent),
        target_decorators=(
            "tool_registry.tool",
            "component_registry.register",
            "event_bus.on",
        ),
    )
    tools = await tool_registry.active_tools()
    logger.info(f"{len(tools.items)} tools available.")
    logger.info("Tools and components loaded.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Asterism backend starting up...")
    await init_system()
    yield
    event_bus.emit(NoArgEvent(type=EventType.SYSTEM_STOP))
    await chat_jobs.shutdown()
    await db_session_manager.close()
    logger.info("Asterism backend shutting up...")
