"""Local generator settings contract; kept free of service imports (US-76.2)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class LocalSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str | None = None
    device: Literal["auto", "cuda", "mps", "cpu"] = "auto"
    # Catalog models whose license an admin accepted before downloading.
    accepted_licenses: list[str] = Field(default_factory=list, max_length=50)
