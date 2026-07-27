from __future__ import annotations

import abc
from collections import defaultdict
from typing import Any, Type, cast

from pydantic import BaseModel

from asterism.core.repositories import settings_repository


class Component(abc.ABC):
    @abc.abstractmethod
    def __call__(self, *args, **kwargs) -> Any: ...

    @classmethod
    def parameters(cls) -> Type[BaseModel]: ...

    @classmethod
    def factory(cls, parameters: BaseModel) -> Component: ...

    @classmethod
    def name(cls) -> str: ...

    @classmethod
    def component_type(cls) -> str: ...

    def __repr__(self):
        return f"{self.__class__.__name__}"


type ComponentFactory = Type[Component]


class ComponentRegistry:
    def __init__(self):
        self.providers_by_type: dict[str, list[ComponentFactory]] = defaultdict(
            list[ComponentFactory]
        )
        self.providers_by_unique_id: dict[str, ComponentFactory] = {}

    def register(self, component_type: type[Component] | None = None):
        def decorator(cls: ComponentFactory):
            effective_type = (
                component_type.component_type()
                if component_type
                else cls.component_type()
            )
            self.providers_by_type[effective_type].append(cls)
            self.providers_by_unique_id[
                f"{effective_type}-{cls.name().upper()}"
            ] = cls
            return cls

        return decorator

    async def get_component[R: Component](
        self,
        component_type: Type[R],
        component_name: str,
    ) -> R:
        key = f"{component_type.component_type()}-{component_name.upper()}"
        if key not in self.providers_by_unique_id:
            raise ValueError(f"Unknown component type: {key}")

        factory = self.providers_by_unique_id[key]
        parameters = factory.parameters()
        prefix = (
            f"{component_type.component_type()}::{component_name.upper()}::"
        )
        settings = await settings_repository.get_settings(
            [f"{prefix}{field}" for field in parameters.model_fields.keys()]
        )
        return cast(
            R,
            self.providers_by_unique_id[key].factory(
                parameters.model_validate(
                    {
                        k.replace(prefix, "").strip(): v
                        for k, v in settings.items()
                    }
                )
            ),
        )

    def get_providers(
        self,
        component_type: str,
    ) -> list[ComponentFactory]:
        return self.providers_by_type[component_type]

    def get_component_types(self) -> list[str]:
        return list(self.providers_by_type.keys())


component_registry: ComponentRegistry = ComponentRegistry()
