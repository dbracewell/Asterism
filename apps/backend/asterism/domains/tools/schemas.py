"""Shared schemas for tool metadata and builtin tool arguments."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from asterism.domains.components.schemas import ComponentType

from .catalog import ToolPolicy


class SearchArgs(BaseModel):
    """Shared model arguments for the web_search and image_search tools."""

    query: str = Field(
        ...,
        description="The search query to use to gather search results",
        title="Query",
    )
    limit: int = Field(
        default=5,
        ge=1,
        le=10,
        description="The maximum number of search results to return",
        title="Limit",
    )
    search_language: str = Field(
        default="auto",
        description="The language to use to gather search results",
        title="Search Language",
    )
    time_range: Literal["past_24_hours", "past_week", "past_month", "all"] = Field(
        default="all",
        description="The time range (past_24_hours, past_week, past_month, all) to limit the search to",  # noqa: E501
        title="Time Range",
    )


class ToolInfo(BaseModel):
    """Catalog entry describing one tool to the frontend.

    Attributes:
        name: Registered tool name (matches settings/allowlist entries).
        description: Model/user-facing description.
        component_type: Component backing the tool, when it wraps one.
        policy: Authorization policy; internal tools are CONTEXT_MANAGED and
            hidden from user capability pickers.
    """

    model_config = ConfigDict(from_attributes=True)
    name: str
    description: str
    component_type: ComponentType | None = None
    policy: ToolPolicy = ToolPolicy.USER_CONFIGURABLE


class ToolInfoList(BaseModel):
    """Envelope for tool catalog responses; items are sorted by name."""

    items: list[ToolInfo]

    def model_post_init(self, __context: Any) -> None:
        # Keep API output deterministic regardless of registration order.
        super().model_post_init(__context)
        self.items.sort(key=lambda t: t.name)
