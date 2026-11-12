import abc
from enum import StrEnum
from typing import Any, ClassVar

from pydantic import BaseModel, Field


class ComponentResponse(BaseModel):
    type: str
    name: str
    parameters: dict[str, Any]
    # The component can check its parameters (e.g. reach a server) before they're saved.
    testable: bool = False


class ComponentTestRequest(BaseModel):
    """Parameters to try, usually unsaved. A redacted secret means "the stored one"."""

    parameters: dict[str, Any] = Field(default_factory=dict)


class ComponentTestResult(BaseModel):
    ok: bool
    detail: str
    # Values the component found for a parameter (e.g. a server's checkpoints), to pick from.
    suggestions: dict[str, list[str]] = Field(default_factory=dict)


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
    parameters: ClassVar[type[BaseModel]]

    def __init__(self, config: T) -> None:
        self.config: T = config

    @abc.abstractmethod
    async def __call__(self, *args, **kwargs) -> Any: ...

    async def test(self) -> ComponentTestResult:
        """Check the parameters work. Components that can, override this."""
        raise NotImplementedError

    @classmethod
    def testable(cls) -> bool:
        return cls.test is not Component.test

    def __repr__(self):
        return f"{self.component_type.value}-{self.name}"
