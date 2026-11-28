"""Usage sources, the per-call meter, and the usage API shapes (ADR-0073)."""

import uuid
from dataclasses import dataclass
from enum import StrEnum

from pydantic import BaseModel, Field

from asterism.domains.settings.pricing import ModelPricing


class UsageSource(StrEnum):
    """What a model call was for. ``BACKGROUND`` sources count but are never refused."""

    CHAT = "chat"
    DELEGATION = "delegation"
    VERIFICATION = "verification"
    DISAGREEMENT = "disagreement"
    COMPACTION = "compaction"
    STUDY = "study"
    REFLECTION = "reflection"
    PROMPT_COACH = "prompt_coach"
    TITLE = "title"
    CAPTION = "caption"
    IMAGE = "image"


BACKGROUND_SOURCES = frozenset({UsageSource.TITLE, UsageSource.CAPTION, UsageSource.COMPACTION})


@dataclass(frozen=True)
class UsageMeter:
    """Who a model call is charged to and what it was for, with the model's price at that moment."""

    user_id: str
    source: UsageSource
    model_id: uuid.UUID | None
    model_name: str
    pricing: ModelPricing | None = None
    plan: bool = False
    chat_id: uuid.UUID | None = None


class UsageWindow(BaseModel):
    """Tokens used in the current day or month, the budget, and when it resets."""

    used_tokens: int = Field(ge=0)
    budget_tokens: int | None = Field(description="None: no budget")
    remaining_tokens: int | None
    starts_at: int = Field(description="Unix seconds")
    resets_at: int = Field(description="Unix seconds")


class UsageModelTotal(BaseModel):
    model_id: uuid.UUID | None
    model_name: str
    input_tokens: int
    output_tokens: int
    images: int
    cost_usd: float | None = Field(description="Estimated from prices at call time; None when no call was priced")
    unpriced_tokens: int = Field(description="Tokens on models with no price or on a ChatGPT plan")


class MyUsage(BaseModel):
    """The signed-in user's usage and remaining budget."""

    timezone: str
    exempt: bool = Field(description="Admins have no budget")
    day: UsageWindow
    month: UsageWindow
    month_by_model: list[UsageModelTotal]


class UsageUserRow(BaseModel):
    user_id: str
    name: str
    email: str
    group_id: str | None
    group_name: str | None
    models: list[UsageModelTotal]
    total_tokens: int
    cost_usd: float | None


class UsageGroupRow(BaseModel):
    group_id: str | None
    group_name: str | None
    users: int
    total_tokens: int
    images: int
    cost_usd: float | None


class UsageReport(BaseModel):
    """Usage over ``[start, end)`` in the instance timezone: per group and in total, and one page of users."""

    timezone: str
    start: int
    end: int
    users: list[UsageUserRow] = Field(description="One page of users matching the filters, most tokens first")
    total_users: int = Field(ge=0, description="Users matching the filters across all pages")
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    groups: list[UsageGroupRow] = Field(description="Every group with usage in the period; filters don't apply")
    total_tokens: int = Field(description="Everyone in the period; filters don't apply")
    cost_usd: float | None


class UsageSettings(BaseModel):
    timezone: str = Field(description="IANA timezone whose midnight starts a budget day, e.g. Europe/London")
