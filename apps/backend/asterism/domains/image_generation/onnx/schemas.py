"""ONNX generator settings contract; kept free of service imports (US-94.4)."""

from pydantic import BaseModel, ConfigDict, Field


class OnnxSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str | None = None
    # Catalog models whose license an admin accepted before downloading.
    accepted_licenses: list[str] = Field(default_factory=list, max_length=50)
