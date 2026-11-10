"""ComfyUI generator settings and admin contracts (US-76.3)."""

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

AuthType = Literal["none", "bearer", "basic"]
MAX_WORKFLOW_BYTES = 256 * 1024


def _clean_url(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    value = value.strip().rstrip("/")
    if not value.startswith(("http://", "https://")) or "?" in value or "#" in value:
        raise ValueError("Use an http:// or https:// address without a query")
    return value


class _Common(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_url: str | None = Field(default=None, max_length=500)
    auth: AuthType = "none"
    # Basic auth only.
    username: str = Field(default="", max_length=200)
    # An API-format workflow ("Save (API)" in ComfyUI) with {{placeholders}};
    # None uses the built-in checkpoint workflow.
    workflow: dict[str, Any] | None = None
    # The checkpoint the built-in workflow loads.
    checkpoint: str = Field(default="", max_length=500)
    steps: int = Field(default=25, ge=1, le=150)
    guidance: float = Field(default=6.0, ge=0, le=30)
    # How long one request may take, all images included.
    timeout_seconds: int = Field(default=300, ge=10, le=600)
    verify_tls: bool = True

    @field_validator("base_url")
    @classmethod
    def _url(cls, value: str | None) -> str | None:
        return _clean_url(value)

    @field_validator("workflow")
    @classmethod
    def _size(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is not None and len(json.dumps(value)) > MAX_WORKFLOW_BYTES:
            raise ValueError("The workflow is too large")
        return value


class ComfyUISettings(_Common):
    """Stored settings. ``token`` is the bearer token or basic password,
    encrypted at rest and never returned."""

    token: str = Field(default="", max_length=4000)


class ComfyUISettingsUpdate(_Common):
    """What the admin page sends. ``token`` None keeps the stored one; "" clears it."""

    token: str | None = Field(default=None, max_length=4000)


class ComfyUISettingsView(_Common):
    has_token: bool = False


class ComfyUIOverview(BaseModel):
    settings: ComfyUISettingsView
    default_workflow: dict[str, Any]
    placeholders: list[str]


class ComfyUITestResult(BaseModel):
    ok: bool
    detail: str
    version: str | None = None
    devices: list[str] = Field(default_factory=list)
    checkpoints: list[str] = Field(default_factory=list)
