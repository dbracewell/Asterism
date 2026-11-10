"""Image generation contracts (ADR-0064). Prompts are untrusted text and grant nothing."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool

ImageProviderName = Literal["none", "comfyui", "diffusers"]
ImageGenerationStatus = Literal["completed", "failed", "refused", "cancelled"]

MAX_PROMPT_LENGTH = 4000
MAX_IMAGES = 4
MIN_SIDE, MAX_SIDE = 256, 2048
DEFAULT_TIMEOUT_SECONDS = 600


class ImageGenerationPolicy(BaseModel):
    """The admin policy: on or off, which groups may use it, and the active provider."""

    model_config = ConfigDict(extra="forbid")
    enabled: StrictBool = False
    # None: every group. A list limits it to those groups (ADR-0058 groups).
    group_ids: list[str] | None = Field(default=None, max_length=200)
    provider: ImageProviderName = "none"


class ImageProviderStatus(BaseModel):
    provider: ImageProviderName
    ready: bool
    detail: str = ""


class ImageGenerationAvailability(BaseModel):
    """Whether this user can generate images now, and why not."""

    available: bool
    reason: str = ""


class ImageRequest(BaseModel):
    """What a provider generates. Sizes are multiples of 16."""

    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=1, max_length=MAX_PROMPT_LENGTH)
    negative_prompt: str = Field(default="", max_length=MAX_PROMPT_LENGTH)
    width: int = Field(default=1024, ge=MIN_SIDE, le=MAX_SIDE, multiple_of=16)
    height: int = Field(default=1024, ge=MIN_SIDE, le=MAX_SIDE, multiple_of=16)
    count: int = Field(default=1, ge=1, le=MAX_IMAGES)
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1)
    steps: int | None = Field(default=None, ge=1, le=150)


class ProviderImage(BaseModel):
    """One image from a provider: PNG bytes and what made it."""

    png: bytes
    seed: int
    width: int
    height: int


class ProviderResult(BaseModel):
    images: list[ProviderImage]
    model: str
    revision: str = ""
    steps: int | None = None


class ImageProgress(BaseModel):
    """Streamed while a job runs, as a ``tool_progress`` event."""

    stage: Literal["queued", "running", "saving"]
    step: int | None = None
    total: int | None = None


class GeneratedImage(BaseModel):
    """A generated image as messages and tool results carry it: a file, never pixels."""

    file_id: uuid.UUID
    filename: str
    width: int
    height: int
    seed: int
    model: str
    prompt: str
    # The Markdown that shows it in a reply: ![name](asterism-file:<id>) (ADR-0039).
    embed: str
