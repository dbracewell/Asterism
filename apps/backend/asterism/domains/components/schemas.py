import abc
from enum import StrEnum
from typing import Any

from pydantic import BaseModel


class ComponentResponse(BaseModel):
    type: str
    name: str
    parameters: dict[str, Any]


class ComponentListResponse(BaseModel):
    items: list[ComponentResponse]


class ComponentType(StrEnum):
    WebSearch = "WebSearch"
    ImageSearch = "ImageSearch"
    ImageGenerator = "ImageGenerator"


class Component[T: BaseModel](abc.ABC):
    component_type: ComponentType
    singleton: bool = False
    name: str
    parameters: type[T]

    def __init__(self, config: T) -> None:
        self.config = config

    @abc.abstractmethod
    async def __call__(self, *args, **kwargs) -> Any: ...

    def __repr__(self):
        return f"{self.component_type.value}-{self.name}"
