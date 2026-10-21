"""Built-in tool registrations."""

import importlib
import pkgutil


def load_builtin_tools() -> None:
    """Dynamically discover and import all tool modules in this package.

    Importing a module registers its ``@tool_registry.tool`` functions on the
    process-wide registry as a side effect; call once at application startup.
    """
    for _, module_name, _ in pkgutil.iter_modules(__path__):
        importlib.import_module(f"{__name__}.{module_name}")
