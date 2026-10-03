from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from uuid import UUID

from asterism.domains.files.schemas import UserFile
from asterism.domains.settings.provider_types import ModelCapabilitySource
from asterism.domains.settings.schemas import Llm


@dataclass(frozen=True)
class CaptionRequest:
    revision_id: UUID
    image_path: Path
    file: UserFile
    max_image_bytes: int
    max_caption_chars: int


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


class CaptionMode(StrEnum):
    DISABLED = "disabled"
    PROVIDER = "provider"
    LOCAL = "local"


@dataclass(frozen=True)
class CaptionResult:
    text: str
    source: CaptionMode
    model: str


@dataclass(frozen=True)
class CaptioningConfiguration:
    mode: CaptionMode = CaptionMode.DISABLED
    provider_model_id: UUID | None = None

    def validate(self, models: list[Llm]) -> None:
        if self.mode is CaptionMode.DISABLED:
            if self.provider_model_id is not None:
                raise CaptioningError(CaptionErrorCode.INVALID_SELECTION, "Disabled captioning cannot select a model")
            return

        if self.mode is CaptionMode.LOCAL:
            if self.provider_model_id is not None:
                raise CaptioningError(
                    CaptionErrorCode.INVALID_SELECTION,
                    "Local captioning cannot select a provider model",
                )
            return

        if self.provider_model_id is None:
            raise CaptioningError(CaptionErrorCode.INVALID_SELECTION, "Provider captioning requires a model")

        selected = next((model for model in models if model.id == self.provider_model_id), None)

        if (
            selected is None
            or not selected.is_active
            or selected.supports_vision is not True
            or selected.vision_source
            not in {
                ModelCapabilitySource.CATALOG,
                ModelCapabilitySource.PROVIDER,
                ModelCapabilitySource.MANUAL,
            }
        ):
            raise CaptioningError(
                CaptionErrorCode.INVALID_SELECTION,
                "Captioning requires an active discovered vision-capable model",
            )


