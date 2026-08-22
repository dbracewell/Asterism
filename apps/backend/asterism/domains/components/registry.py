from __future__ import annotations

from collections import defaultdict
from typing import Any

from asterism.core.schemas import NoArgs

from .schemas import Component, ComponentType


class ComponentRegistry:
    def __init__(self):
        self.providers_by_type: dict[ComponentType, list[type[Component]]] = (
            defaultdict(list)
        )
        self.providers_by_unique_id: dict[str, type[Component]] = {}
        self.singletons: dict[str, Component] = {}

    @staticmethod
    def _make_key(component_type: ComponentType, name: str) -> str:
        return f"{component_type.value}-{name.upper()}"

    def register(self):
        def decorator(cls: type[Component[Any]]):
            unique_key = ComponentRegistry._make_key(
                cls.component_type,
                cls.name,
            )
            if unique_key not in self.providers_by_unique_id:
                self.providers_by_type[cls.component_type].append(cls)
                self.providers_by_unique_id[unique_key] = cls
            return cls

        return decorator

    async def get_component(
        self,
        component_type: ComponentType,
        component_name: str | None = None,
        parameters_dict: dict[str, Any] | None = None,
    ) -> Component:
        if component_name is None:
            component_name = component_type.value

        key = ComponentRegistry._make_key(component_type, component_name)

        factory = self.providers_by_unique_id[key]
        if factory.singleton and key in self.singletons:
            return self.singletons[key]

        if parameters_dict:
            instance = factory(
                factory.parameters.model_validate(parameters_dict)  # pyright: ignore[reportGeneralTypeIssues]
            )
        else:
            instance = factory(NoArgs())

        if factory.singleton:
            self.singletons[key] = instance

        return instance

    def get_providers[T](
        self,
        component_type: ComponentType,
    ) -> list[type[Component[Any]]]:
        return self.providers_by_type[component_type]


component_registry: ComponentRegistry = ComponentRegistry()
