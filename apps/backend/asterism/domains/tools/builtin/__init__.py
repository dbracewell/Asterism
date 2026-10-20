"""Built-in tool registrations."""

import importlib
import pkgutil


def load_builtin_tools() -> None:
    """Dynamically discover and import all tool modules in this package."""
    for _, module_name, _ in pkgutil.iter_modules(__path__):
        importlib.import_module(f"{__name__}.{module_name}")
