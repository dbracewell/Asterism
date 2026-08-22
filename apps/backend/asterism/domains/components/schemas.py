import abc
from enum import StrEnum
from typing import Any, ClassVar

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
    component_type: ClassVar[ComponentType]
    singleton: ClassVar[bool] = False
    name: ClassVar[str]
    parameters: ClassVar[BaseModel]

    def __init__(self, config: T) -> None:
        self.config:T = config

    @abc.abstractmethod
    async def __call__(self, *args, **kwargs) -> Any: ...

    def __repr__(self):
        return f"{self.component_type.value}-{self.name}"
