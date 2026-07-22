import abc
import importlib
import pkgutil
import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import Annotated, Any, Dict, Type, Union

from pydantic import BaseModel, Field, TypeAdapter

_providers: list[Type[BaseModel]] = []
_providers_by_type: dict[str, list[Type[BaseModel]]] = defaultdict(
    list[Type[BaseModel]]
)
_adapter: TypeAdapter | None = None


@dataclass
class Component:
    pass


class ComponentProvider[T: Component](BaseModel, abc.ABC):
    name: str

    @abc.abstractmethod
    def create_component(self) -> T:
        pass


def register_component(component_type: str):
    def decorator(cls):
        global _providers
        global _providers_by_type
        global _adapter

        _providers.append(cls)
        _providers_by_type[component_type].append(cls)
        _adapter = None
        return cls

    return decorator


def get_component_types() -> list[str]:
    return list(_providers_by_type.keys())


def get_components(component_type: str) -> list[Type[BaseModel]]:
    return _providers_by_type[component_type]


def _get_adapter() -> TypeAdapter:
    global _providers
    global _providers_by_type
    global _adapter

    if not _providers:
        raise ValueError("No components registered!")

    if _adapter is None:
        dynamic_union = Union[tuple(_providers)]  # type: ignore
        discriminated_type = Annotated[dynamic_union, Field(discriminator="type")]
        _adapter = TypeAdapter(list[discriminated_type])  # type: ignore

    assert _adapter is not None
    return _adapter


def validate_component(payload: dict[str, Any]) -> Component | list[Component]:
    adapter = _get_adapter()
    return adapter.validate_python(payload)


def load_plugins_recursive(package_name: str) -> Dict[str, Any]:
    imported_plugins = {}

    try:
        parent_package = importlib.import_module(package_name)
    except ModuleNotFoundError:
        print(f"Error: Parent package '{package_name}' not found.")
        return imported_plugins

    package_path = getattr(parent_package, "__path__", None)
    if package_path is None:
        print(f"Error: '{package_name}' is a module, not a package container.")
        return imported_plugins

    prefix = f"{parent_package.__name__}."
    for module_info in pkgutil.walk_packages(package_path, prefix):
        if module_info.ispkg:
            continue

        try:
            module = importlib.import_module(module_info.name)
            imported_plugins[module_info.name] = module

        except Exception as e:
            print(f"Failed to load plugin {module_info.name}: {e}", file=sys.stderr)

    return imported_plugins


# load_plugins_recursive("asterism.core.components")
