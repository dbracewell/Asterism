"""Bounded, offline-safe image-captioning contracts and local SmolVLM2 adapter."""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol
from uuid import UUID

from PIL import Image
from pydantic import BaseModel, ConfigDict

from asterism.common.hashing import sha256_file
from asterism.domains.settings.provider_types import ModelCapabilitySource

LOCAL_SMOLVLM2_MODEL_ID = "HuggingFaceTB/SmolVLM2-256M-Video-Instruct"
LOCAL_SMOLVLM2_REVISION = "067788b187b95ebe7b2e040b3e4299e342e5b8fd"


class CaptionMode(StrEnum):
    DISABLED = "disabled"
    PROVIDER = "provider"
    LOCAL = "local"


class CaptionStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DRAFT = "draft"
    ACCEPTED = "accepted"
    CLEARED = "cleared"
    FAILED = "failed"
    CANCELED = "canceled"


class DownloadStatus(StrEnum):
    IDLE = "idle"
    DOWNLOADING = "downloading"
    VERIFYING = "verifying"
    READY = "ready"
    FAILED = "failed"


class CaptionModelStatus(BaseModel):
    """Admin-facing status of the local caption model download/readiness."""

    model_config = ConfigDict(frozen=True)

    status: DownloadStatus
    bytes_downloaded: int = 0
    total_bytes: int = 0
    error: str | None = None
    bundle_sha256: str | None = None


class CaptionErrorCode(StrEnum):
    DISABLED = "disabled"
    INVALID_SELECTION = "invalid_selection"
    NOT_READY = "not_ready"
    ARTIFACT_MISSING = "artifact_missing"
    ARTIFACT_INVALID = "artifact_invalid"
    IMAGE_INVALID = "image_invalid"
    PROVIDER_FAILURE = "provider_failure"
    TIMEOUT = "timeout"
    OUTPUT_INVALID = "output_invalid"


class CaptioningError(RuntimeError):
    """Safe error suitable for persistence or user display; never include image data."""

    def __init__(self, code: CaptionErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class CaptionRequest:
    revision_id: UUID
    image_path: Path
    max_image_bytes: int
    max_caption_chars: int


@dataclass(frozen=True)
class CaptionResult:
    text: str
    source: CaptionMode
    model: str


@dataclass(frozen=True)
class CaptionRevisionRecord:
    """Derived caption state for one immutable knowledge document revision."""

    revision_id: UUID
    status: CaptionStatus
    source: CaptionMode | None = None
    model: str | None = None
    text: str | None = None
    error_code: CaptionErrorCode | None = None
    error_reason: str | None = None
    generated_at: datetime | None = None
    accepted_at: datetime | None = None


class CaptionProvider(Protocol):
    """A provider receives only a local image reference and returns bounded plain text."""

    async def caption(self, request: CaptionRequest) -> CaptionResult: ...

    async def close(self) -> None: ...


@dataclass(frozen=True)
class CaptioningConfiguration:
    mode: CaptionMode = CaptionMode.DISABLED
    provider_model_id: UUID | None = None

    def validate(self, models: list[CaptionableModel]) -> None:
        if self.mode is CaptionMode.DISABLED:
            if self.provider_model_id is not None:
                raise CaptioningError(CaptionErrorCode.INVALID_SELECTION, "Disabled captioning cannot select a model")
            return
        if self.mode is CaptionMode.LOCAL:
            if self.provider_model_id is not None:
                raise CaptioningError(
                    CaptionErrorCode.INVALID_SELECTION, "Local captioning cannot select a provider model"
                )
            return
        if self.provider_model_id is None:
            raise CaptioningError(CaptionErrorCode.INVALID_SELECTION, "Provider captioning requires a model")
        selected = next((model for model in models if model.id == self.provider_model_id), None)
        if (
            selected is None
            or not selected.is_active
            or selected.supports_vision is not True
            or selected.vision_source not in {ModelCapabilitySource.CATALOG, ModelCapabilitySource.PROVIDER}
        ):
            raise CaptioningError(
                CaptionErrorCode.INVALID_SELECTION,
                "Captioning requires an active discovered vision-capable model",
            )


class CaptionableModel(Protocol):
    id: UUID
    is_active: bool
    supports_vision: bool | None
    vision_source: ModelCapabilitySource


def bounded_caption(text: str, limit: int) -> str:
    normalized = " ".join(text.split())
    if not normalized:
        raise CaptioningError(CaptionErrorCode.OUTPUT_INVALID, "Caption provider returned no description")
    if len(normalized) > limit:
        return normalized[:limit].rstrip()
    return normalized


class LocalSmolVlm2CaptionProvider:
    """CPU-only SmolVLM2 adapter that will only load an already-provisioned bundle."""

    MANIFEST_FILENAME = "manifest.json"
    MAX_MANIFEST_BYTES = 1024 * 1024

    def __init__(
        self,
        model_root: Path,
        *,
        bundle_sha256: str,
        max_concurrency: int = 1,
        max_new_tokens: int = 128,
    ) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be positive")
        if not 1 <= max_new_tokens <= 512:
            raise ValueError("max_new_tokens must be from 1 to 512")
        self._model_root = model_root.resolve()
        self._bundle_sha256 = bundle_sha256.lower()
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._max_new_tokens = max_new_tokens
        self._model: Any | None = None
        self._processor: Any | None = None

    @property
    def manifest_path(self) -> Path:
        return self._model_root / self.MANIFEST_FILENAME

    def _verify_artifact(self) -> None:
        if len(self._bundle_sha256) != 64 or any(char not in "0123456789abcdef" for char in self._bundle_sha256):
            raise CaptioningError(CaptionErrorCode.NOT_READY, "Local caption model has not been provisioned")
        if not self.manifest_path.is_file():
            raise CaptioningError(CaptionErrorCode.ARTIFACT_MISSING, "Local caption model artifact is missing")
        try:
            if self.manifest_path.stat().st_size > self.MAX_MANIFEST_BYTES:
                raise CaptioningError(CaptionErrorCode.ARTIFACT_INVALID, "Local caption model manifest is too large")
            manifest_bytes = self.manifest_path.read_bytes()
            if hashlib.sha256(manifest_bytes).hexdigest() != self._bundle_sha256:
                raise CaptioningError(
                    CaptionErrorCode.ARTIFACT_INVALID, "Local caption model manifest verification failed"
                )
            manifest = json.loads(manifest_bytes)
            if not isinstance(manifest, dict) or (
                manifest.get("model_id") != LOCAL_SMOLVLM2_MODEL_ID
                or manifest.get("revision") != LOCAL_SMOLVLM2_REVISION
            ):
                raise ValueError("model identity")
            files = manifest["files"]
            if not isinstance(files, dict) or not files:
                raise ValueError("files")
            for relative_path, expected_sha256 in files.items():
                if not isinstance(relative_path, str) or not isinstance(expected_sha256, str):
                    raise ValueError("file entry")
                path = (self._model_root / relative_path).resolve()
                if self._model_root not in path.parents or not path.is_file():
                    raise CaptioningError(
                        CaptionErrorCode.ARTIFACT_MISSING, "Local caption model artifact is incomplete"
                    )
                if sha256_file(path) != expected_sha256.lower():
                    raise CaptioningError(
                        CaptionErrorCode.ARTIFACT_INVALID, "Local caption model artifact verification failed"
                    )
        except CaptioningError:
            raise
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
            raise CaptioningError(
                CaptionErrorCode.ARTIFACT_INVALID, "Local caption model manifest is invalid"
            ) from error

    def _initialize_sync(self) -> None:
        self._verify_artifact()
        try:
            import torch
            from transformers import AutoModelForImageTextToText, AutoProcessor

            self._processor = AutoProcessor.from_pretrained(
                self._model_root, local_files_only=True, trust_remote_code=False
            )
            model = AutoModelForImageTextToText.from_pretrained(
                self._model_root,
                local_files_only=True,
                trust_remote_code=False,
                torch_dtype=torch.float32,
            )
            self._model = getattr(model, "to")("cpu").eval()
        except CaptioningError:
            raise
        except Exception as error:
            self._model = None
            self._processor = None
            raise CaptioningError(CaptionErrorCode.NOT_READY, "Local caption model could not be initialized") from error

    async def initialize(self) -> None:
        if self._model is None or self._processor is None:
            await asyncio.to_thread(self._initialize_sync)

    def _caption_sync(self, request: CaptionRequest) -> str:
        if self._model is None or self._processor is None:
            raise CaptioningError(CaptionErrorCode.NOT_READY, "Local caption model is not initialized")
        try:
            if not request.image_path.is_file() or request.image_path.stat().st_size > request.max_image_bytes:
                raise CaptioningError(
                    CaptionErrorCode.IMAGE_INVALID, "Image is unavailable or exceeds the captioning limit"
                )
            with Image.open(request.image_path) as image:
                image.verify()
            with Image.open(request.image_path) as image:
                rgb_image = image.convert("RGB")
                messages = [
                    {
                        "role": "user",
                        "content": [
                            {"type": "image"},
                            {"type": "text", "text": "Describe this image concisely."},
                        ],
                    }
                ]
                prompt = self._processor.apply_chat_template(messages, add_generation_prompt=True)
                inputs = self._processor(text=prompt, images=[rgb_image], return_tensors="pt")
                generated = self._model.generate(**inputs, max_new_tokens=self._max_new_tokens, do_sample=False)
                prompt_tokens = inputs["input_ids"].shape[1]
                return self._processor.decode(generated[0][prompt_tokens:], skip_special_tokens=True)
        except CaptioningError:
            raise
        except Exception as error:
            raise CaptioningError(CaptionErrorCode.IMAGE_INVALID, "Image could not be captioned locally") from error

    async def caption(self, request: CaptionRequest) -> CaptionResult:
        await self.initialize()
        async with self._semaphore:
            text = await asyncio.to_thread(self._caption_sync, request)
        return CaptionResult(
            text=bounded_caption(text, request.max_caption_chars), source=CaptionMode.LOCAL, model="SmolVLM2"
        )

    async def close(self) -> None:
        self._model = None
        self._processor = None
