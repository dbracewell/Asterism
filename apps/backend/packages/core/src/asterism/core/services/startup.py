from asterism.core.db import db_session_manager
from asterism.core.llm.draft import get_draft_model
from asterism.core.utils.package_walker import walk_modules


async def init_system():
    get_draft_model()
    db_session_manager.init()
    walk_modules("asterism.core.tools")
    walk_modules("asterism.core.components")
