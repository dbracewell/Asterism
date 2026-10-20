from contextlib import asynccontextmanager

from fastapi import FastAPI

from asterism.common.log import get_logger
from asterism.core import config
from asterism.db.database import db_session_manager
from asterism.domains.chat.jobs import chat_jobs
from asterism.domains.extraction.runtime import (
    initialize_knowledge_runtime,
    shutdown_knowledge_runtime,
)
from asterism.domains.llm.client import close_openai_clients
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
    await initialize_knowledge_runtime()
    logger.info("Knowledge vector store initialized.")
    logger.info("Loading tools and components...")
    from asterism.domains.components.builtin import load_builtin_components
    from asterism.domains.tools.builtin import load_builtin_tools

    load_builtin_components()
    load_builtin_tools()

    tools = await tool_registry.active_tools()
    logger.info(f"{len(tools.items)} tools available.")
    logger.info("Tools and components loaded.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Asterism backend starting up...")
    await init_system()
    yield
    event_bus.emit(NoArgEvent(type=EventType.SYSTEM_STOP))
    await event_bus.shutdown()
    await chat_jobs.shutdown()
    await shutdown_knowledge_runtime()
    await close_openai_clients()
    await db_session_manager.close()
    logger.info("Asterism backend shutting up...")
