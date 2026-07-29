from asterism.db import db_session_manager
from asterism.llm.draft import get_draft_model
from asterism.utils.package_walker import walk_modules


async def init_system():
    get_draft_model()
    db_session_manager.init()
    walk_modules("asterism.tools")
    walk_modules("asterism.components")
