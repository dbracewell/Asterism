"""FastAPI lifespan wiring: ordered startup of all subsystems and their teardown."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from asterism.common.log import get_logger
from asterism.core import config
from asterism.db.database import db_session_manager
from asterism.domains.chat.jobs import chat_jobs
from asterism.domains.knowledge.runtime import (
    initialize_knowledge_runtime,
    shutdown_knowledge_runtime,
)
from asterism.domains.llm.client import close_openai_clients
from asterism.domains.llm.draft import get_draft_model
from asterism.domains.tools.builtin.fetch import close_fetch_browser
from asterism.domains.tools.registry import tool_registry

from .events import EventType, NoArgEvent, event_bus

logger = get_logger("ASTERISM")


async def init_system() -> None:
    """Bring up all backend subsystems in dependency order.

    Validates configuration, prepares storage directories, initializes the
    database session manager and knowledge runtime, loads the event-bus handler
    module manifest, then loads built-in components/tools into the tool registry.
    """
    config.validate_runtime()
    config.prepare_storage()
    get_draft_model()
    await db_session_manager.init()
    logger.info("Database session manager initialized.")
    await initialize_knowledge_runtime()
    logger.info("Knowledge vector store initialized.")
    logger.info("Loading tools and components...")
    from asterism.core import event_handlers  # noqa: F401 - event-bus handler module manifest
    from asterism.domains.components.builtin import load_builtin_components
    from asterism.domains.settings.service import get_app_settings
    from asterism.domains.tools.builtin import load_builtin_tools

    load_builtin_components()
    load_builtin_tools()

    tools = tool_registry.active_tools(await get_app_settings())
    logger.info(f"{len(tools.items)} tools available.")
    logger.info(
        "Event handlers registered: %s",
        {t.value: sorted(h.__qualname__ for h in handlers.values()) for t, handlers in event_bus.handlers.items()},
    )
    logger.info("Tools and components loaded.")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """FastAPI lifespan handler: starts the system before serving and tears everything down after.

    Teardown order is the reverse of startup: event bus, chat jobs, knowledge
    runtime, LLM HTTP clients, then the database session manager.

    Args:
        app: The FastAPI application instance (unused beyond context).
    """
    logger.info("Asterism backend starting up...")
    await init_system()
    event_bus.emit(NoArgEvent(type=EventType.SYSTEM_START))
    yield
    event_bus.emit(NoArgEvent(type=EventType.SYSTEM_STOP))
    await event_bus.shutdown()
    await chat_jobs.shutdown()
    await shutdown_knowledge_runtime()
    await close_fetch_browser()
    await close_openai_clients()
    await db_session_manager.close()
    logger.info("Asterism backend shutting down...")
