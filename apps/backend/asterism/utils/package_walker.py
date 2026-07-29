import importlib
import pkgutil

from asterism.utils.log import get_logger


def walk_modules(module: str) -> None:
    logger = get_logger(f"WALK_MODULES: {module}")
    try:
        parent_package = importlib.import_module(module)
    except ModuleNotFoundError:
        logger.warning(f"Error: Parent package '{module}' not found.")
        return

    package_path = getattr(parent_package, "__path__", None)
    if package_path is None:
        logger.warning(
            f"Error: '{module}' is a module, not a package container."
        )
        return

    prefix = f"{parent_package.__name__}."
    for module_info in pkgutil.walk_packages(package_path, prefix):
        if module_info.ispkg:
            continue

        try:
            importlib.import_module(module_info.name)
        except Exception as e:
            logger.warning(f"Failed to load plugin {module_info.name}: {e}")
