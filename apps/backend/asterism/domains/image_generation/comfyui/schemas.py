"""ComfyUI generator parameters (US-76.3).

This is the component's parameter model: the admin page renders it as a form
from its JSON schema, and saving validates against it. ``token`` is a secret
by name, so it is encrypted at rest and redacted in responses like other
component secrets.
"""

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .workflow import DEFAULT_WORKFLOW, PLACEHOLDERS, check_workflow

AuthType = Literal["none", "bearer", "basic"]
MAX_WORKFLOW_BYTES = 256 * 1024
_PLACEHOLDER_LIST = ", ".join("{{" + name + "}}" for name in PLACEHOLDERS)


class ComfyUIParameters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_url: str = Field(
        default="",
        max_length=500,
        title="Server address",
        description="The ComfyUI server, for example http://comfyui:8188. A path prefix behind a proxy is fine.",
    )
    auth: AuthType = Field(
        default="none",
        title="Sign-in",
        description="ComfyUI has no sign-in of its own; use bearer or basic behind a proxy that needs one.",
    )
    username: str = Field(default="", max_length=200, title="Username", description="For basic sign-in only.")
    token: str = Field(
        default="",
        max_length=4000,
        title="Token or password",
        description="The bearer token, or the basic sign-in password. Stored encrypted.",
    )
    checkpoint: str = Field(
        default="",
        max_length=500,
        title="Checkpoint",
        description="The model file the built-in workflow loads. Test the connection to list the server's checkpoints.",
    )
    workflow: dict[str, Any] | None = Field(
        default=None,
        title="Custom workflow",
        description=(
            "Leave empty to use the built-in workflow. Otherwise paste a workflow exported with Save (API), "
            f"marking inputs with placeholders: {_PLACEHOLDER_LIST}. {{{{prompt}}}} is required."
        ),
        examples=[DEFAULT_WORKFLOW],
    )
    steps: int = Field(default=25, ge=1, le=150, title="Steps", description="When the request doesn't set them.")
    guidance: float = Field(default=6.0, ge=0, le=30, title="Guidance (CFG)")
    timeout_seconds: int = Field(
        default=300, ge=10, le=600, title="Timeout (seconds)", description="For one request, all images included."
    )
    verify_tls: bool = Field(
        default=True, title="Verify TLS certificates", description="Turn off only for a self-signed certificate."
    )

    @field_validator("base_url")
    @classmethod
    def _url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if value and (not value.startswith(("http://", "https://")) or "?" in value or "#" in value):
            raise ValueError("Use an http:// or https:// address without a query")
        return value

    @field_validator("workflow")
    @classmethod
    def _workflow(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if not value:
            return None
        if len(json.dumps(value)) > MAX_WORKFLOW_BYTES:
            raise ValueError("The workflow is too large")
        check_workflow(value)
        return value
