"""Built-in component registrations."""

import importlib
import pkgutil


def load_builtin_components() -> None:
    """Dynamically discover and import all component modules in this package."""
    for _, module_name, _ in pkgutil.iter_modules(__path__):
        importlib.import_module(f"{__name__}.{module_name}")
