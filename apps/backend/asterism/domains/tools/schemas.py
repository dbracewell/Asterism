from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from asterism.domains.components.schemas import ComponentType


class SearchTimeRange(StrEnum):
    ALL = "all"
    DAY = "day"
    MONTH = "month"
    YEAR = "year"


class SearchArgs(BaseModel):
    query: str = Field(
        ...,
        description="The search query to use to gather search results",
        title="Query",
    )
    limit: int = Field(
        default=5,
        description="The maximum number of search results to return",
        title="Limit",
    )
    search_language: str = Field(
        default="all",
        description="The language to use to gather search results",
        title="Search Language",
    )
    time_range: SearchTimeRange = Field(
        default=SearchTimeRange.ALL,
        description="The time range (ALL, DAY, MONTH, YEAR) to limit the search to",
        title="Time Range",
    )


class ToolInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    description: str
    component_type: ComponentType | None = None


class ToolInfoList(BaseModel):
    items: list[ToolInfo]

    def model_post_init(self, __context: Any) -> None:
        super().model_post_init(__context)
        self.items.sort(key=lambda t: t.name)
