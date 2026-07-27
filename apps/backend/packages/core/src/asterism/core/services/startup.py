from asterism.core.db import db_session_manager
from asterism.core.utils.package_walker import walk_modules


async def init_system():
    db_session_manager.init()
    walk_modules("asterism.core.tools")
    walk_modules("asterism.core.components")
