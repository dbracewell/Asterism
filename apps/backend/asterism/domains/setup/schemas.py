"""Setup progress (US-101.2): one entry per walkthrough step the admin has acted on."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

StepId = Field(pattern=r"^[a-z][a-z0-9_-]{0,39}$")


class SetupStepState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: Literal["done", "skipped"]
    at: int = Field(ge=0)
    # Who acted, so a second administrator sees whose choice it was.
    by: str | None = Field(default=None, max_length=200)


class SetupProgress(BaseModel):
    """Steps not listed have not been reviewed."""

    model_config = ConfigDict(extra="forbid")

    steps: dict[str, SetupStepState] = Field(default_factory=dict, max_length=100)


class SetupStepUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # None reopens the step as not reviewed.
    state: Literal["done", "skipped"] | None
