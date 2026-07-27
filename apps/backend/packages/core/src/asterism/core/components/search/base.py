import abc
from dataclasses import dataclass
from typing import Type

from pydantic import BaseModel, ConfigDict

from asterism.core.registries.component import (
    Component,
    component_registry,
)


@dataclass
class SearchResult:
    title: str
    url: str


class SearchXNGConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    host: str = "localhost"
    port: int = 8080


class WebsearchComponent(Component, abc.ABC):
    @classmethod
    def component_type(cls) -> str:
        return "WebSearch"

    @abc.abstractmethod
    def __call__(self, query: str, limit: int) -> list[SearchResult]:
        pass


@component_registry.register(WebsearchComponent)
class SearchXNGComponent(WebsearchComponent):
    def __init__(self, host: str, port: int) -> None:
        self.host = host
        self.port = port

    def __call__(self, query: str, limit: int) -> list[SearchResult]:
        pass

    def __repr__(self):
        return f"{self.__class__.__name__}({self.host}, {self.port})"

    @classmethod
    def name(cls) -> str:
        return "SearchXNG"

    @classmethod
    def parameters(cls) -> Type[BaseModel]:
        return SearchXNGConfig

    @classmethod
    def factory(cls, parameters: SearchXNGConfig) -> Component:
        return SearchXNGComponent(
            host=parameters.host,
            port=parameters.port,
        )


class DuckDuckGoConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    api_key: str = ""


@component_registry.register(WebsearchComponent)
class DuckDuckGoComponent(WebsearchComponent):
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def __call__(self, query: str, limit: int) -> list[SearchResult]:
        pass

    def __repr__(self):
        return f"{self.__class__.__name__}({self.api_key})"

    @classmethod
    def name(cls) -> str:
        return "DuckDuckGo"

    @classmethod
    def parameters(cls) -> Type[BaseModel]:
        return DuckDuckGoConfig

    @classmethod
    def factory(cls, parameters: DuckDuckGoConfig) -> Component:
        return DuckDuckGoComponent(api_key=parameters.api_key)
