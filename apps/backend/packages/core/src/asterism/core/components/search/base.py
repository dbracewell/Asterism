import abc
from dataclasses import dataclass

from asterism.core.component import Component, ComponentProvider, register_component


@dataclass
class SearchResult:
    title: str
    url: str


class WebSearchComponent(Component, abc.ABC):
    @abc.abstractmethod
    def search(self, query: str, limit: int) -> list[SearchResult]: ...


class SearchXNGComponent(WebSearchComponent):
    def __init__(self, host: str, port: int) -> None:
        self.host = host
        self.port = port

    def search(self, query: str, limit: int) -> list[SearchResult]:
        pass


@register_component(component_type="WebSearch")
class SearchXNGProvider(ComponentProvider[WebSearchComponent]):
    name: str = "SearchXNG"
    host: str = "localhost"
    port: int = 8080

    def create_component(self) -> WebSearchComponent:
        return SearchXNGComponent(host=self.host, port=self.port)
