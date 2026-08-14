import abc

from pydantic import BaseModel

from asterism.domains.components.registry import component_registry
from asterism.domains.components.schemas import ComponentType
from asterism.domains.tools.schemas import SearchArgs

from .base_search import SearchComponent, SearchResult
from .searxng import SearchXNGConfig, searxng


class ImageSearchComponent[T: BaseModel](SearchComponent[T], abc.ABC):
    component_type = ComponentType.ImageSearch


@component_registry.register()
class SearchXNG(ImageSearchComponent[SearchXNGConfig]):
    name: str = "SearchXNGImageSearch"
    parameters: type[SearchXNGConfig] = SearchXNGConfig

    def __init__(self, config: SearchXNGConfig) -> None:
        super().__init__(config)

    async def __call__(self, args: SearchArgs) -> list[SearchResult]:
        return await searxng(
            args=args,
            category="image",
            config=self.config,
        )
