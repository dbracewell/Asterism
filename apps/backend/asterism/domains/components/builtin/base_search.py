import abc
from dataclasses import dataclass
from enum import StrEnum

from pydantic import BaseModel

from asterism.domains.components.schemas import Component
from asterism.domains.tools.schemas import SearchArgs


class SafeSearch(StrEnum):
    OFF = "OFF"
    MODERATE = "MODERATE"
    STRICT = "STRICT"


@dataclass
class SearchResult:
    title: str
    url: str
    relevance_score: float
    snippet: str | None = None


class SearchComponent[T: BaseModel](Component[T], abc.ABC):
    @abc.abstractmethod
    async def __call__(self, args: SearchArgs) -> list[SearchResult]: ...
