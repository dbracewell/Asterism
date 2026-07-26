import importlib
import pkgutil

import asterism.core.llm.tools


async def load_tools():
    for _, module_name, _ in pkgutil.walk_packages(
        path=asterism.core.llm.tools.__path__,
        prefix=asterism.core.llm.tools.__name__ + ".",
    ):
        importlib.import_module(module_name)
