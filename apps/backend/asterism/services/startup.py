from pathlib import Path

from asterism.db import db_session_manager
from asterism.llm.draft import get_draft_model
from asterism.registries import tool_registry
from asterism.utils.log import get_logger
from asterism.utils.package_walker import load_decorators

logger = get_logger("ASTERISM")


async def init_system() -> None:
    get_draft_model()
    db_session_manager.init()
    logger.info("Database session manager initialized.")
    logger.info("Loading tools and components...")
    load_decorators(
        str(Path(__file__).parent.parent),
        target_decorators=(
            "tool_registry.tool",
            "component_registry.register",
        ),
    )
    logger.info(f"{len(tool_registry.tools())} tools available.")
    logger.info("Tools and components loaded.")
