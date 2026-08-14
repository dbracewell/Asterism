from enum import StrEnum

from pydantic import BaseModel, Field


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
