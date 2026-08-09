from __future__ import annotations

import abc
from enum import StrEnum
from typing import Any

from pydantic import BaseModel


class ComponentType(StrEnum):
    WebSearch = "WebSearch"
    ImageSearch = "ImageSearch"
    LLMClientProvider = "LLMClientProvider"
    ImageGenerator = "ImageGenerator"
    MemoryProvider = "MemoryProvider"


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
