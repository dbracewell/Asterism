"""The settings export format (ADR-0052).

A file is a small JSON envelope around one encrypted bundle. Everything except
the format marker and salt is inside the ciphertext, including provider names and
URLs. The key comes from the passphrase through scrypt; its cost is fixed by the
format version rather than read from the file, so a crafted file cannot demand
excessive memory. Fernet authenticates the ciphertext, so an altered file and a
wrong passphrase fail the same way and reveal nothing.
"""

import base64
import os
import unicodedata
from typing import Literal

from cryptography.exceptions import InvalidKey
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from pydantic import BaseModel, ConfigDict, Field, JsonValue, PositiveInt, ValidationError

from asterism.core.exceptions import BadDataException
from asterism.domains.settings.pricing import ModelPricing
from asterism.domains.settings.provider_types import ModelCapabilitySource, ProviderType

SETTINGS_FORMAT = "asterism.settings-export"
SETTINGS_FORMAT_VERSION = 1
MIN_PASSPHRASE_LENGTH = 12
MAX_PASSPHRASE_LENGTH = 1024
MAX_SETTINGS_FILE_BYTES = 8 * 1024 * 1024
_SALT_BYTES = 16
_SCRYPT_N = 2**17
_SCRYPT_R = 8
_SCRYPT_P = 1
_OPEN_FAILED = "Could not open this file. Check the passphrase, or the file may be damaged."


class _Document(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ModelReference(_Document):
    """A model by name, because record IDs differ between instances."""

    provider: str
    model: str


class ExportedModel(_Document):
    name: str
    display_name: str | None = None
    is_active: bool
    context_window: PositiveInt | None = None
    supports_vision: bool | None = None
    supports_tools: bool | None = None
    tools_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    context_window_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    vision_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    pricing: ModelPricing | None = None


class ExportedProvider(_Document):
    name: str
    provider_type: ProviderType
    base_url: str
    api_key: str = Field(repr=False)
    models: tuple[ExportedModel, ...] = ()


class ExportedComponent(_Document):
    """A component provider (search, image generator). Unlike the API schema, this keeps secret values."""

    name: str
    parameters: dict[str, JsonValue] = Field(default_factory=dict, repr=False)


class ExportedCaptioning(_Document):
    mode: Literal["disabled", "provider", "local"] = "disabled"
    model: ModelReference | None = None


class ExportedImageGeneration(_Document):
    """Image generation policy and provider (ADR-0064). Group limits stay with the
    installation: group ids differ between installations."""

    enabled: bool = False


class ExportedMemory(_Document):
    """The memory policy (ADR-0078). Group limits stay with the installation:
    group ids differ between installations. Memories themselves are never in it."""

    enabled: bool = False


class ExportedStudyChat(_Document):
    """Decks and quizzes from chat (EPIC-98). Group limits stay with the
    installation, as for memory."""

    enabled: bool = True


class ExportedLocalImage(_Document):
    """The local generator's model and device (US-76.2). Downloads and license
    acceptance stay with the installation."""

    model_id: str | None = None
    device: Literal["auto", "cuda", "mps", "cpu"] = "auto"


class ExportedOnnxImage(_Document):
    """The ONNX generator's model (US-94.4). Downloads and license acceptance stay
    with the installation."""

    model_id: str | None = None


class ExportedCompaction(_Document):
    """Context compaction policy (ADR-0060); the summarizer model travels by name."""

    threshold: float = Field(default=0.8, ge=0.5, le=0.95)
    tail_turns: int = Field(default=3, ge=1, le=20)
    fallback_context_window: int = Field(default=32_768, ge=2_048, le=10_000_000)
    model: ModelReference | None = None


class ExportedGroup(_Document):
    """A group's access lists (ADR-0058). Membership is never exported.

    Built-in groups are matched by ``built_in`` key and custom ones by name.
    None allows every enabled model or tool.
    """

    name: str = Field(min_length=1, max_length=80)
    built_in: Literal["admin", "educator", "student"] | None = None
    models: tuple[ModelReference, ...] | None = None
    tools: tuple[str, ...] | None = None


class SettingsBundle(_Document):
    """Every application setting. A test keeps this in step with the settings."""

    exported_at: int
    providers: tuple[ExportedProvider, ...] = ()
    draft_model: ModelReference | None = None
    active_tools: tuple[str, ...] = ()
    skills_enabled: bool = False
    canvas_enabled: bool = False
    image_generation: ExportedImageGeneration = Field(default_factory=ExportedImageGeneration)
    image_generation_local: ExportedLocalImage = Field(default_factory=ExportedLocalImage)
    # Added in US-94.4; files exported before it read as no ONNX model chosen.
    image_generation_onnx: ExportedOnnxImage = Field(default_factory=ExportedOnnxImage)
    image_generator_provider: ExportedComponent | None = None
    # Added in US-93.2; files exported before it read as memory off.
    memory: ExportedMemory = Field(default_factory=ExportedMemory)
    # Added in US-98.1; files exported before it read as on, the default.
    study_chat: ExportedStudyChat = Field(default_factory=ExportedStudyChat)
    chatgpt_plan_enabled: bool = False
    web_search_provider: ExportedComponent | None = None
    image_search_provider: ExportedComponent | None = None
    captioning: ExportedCaptioning = Field(default_factory=ExportedCaptioning)
    compaction: ExportedCompaction = Field(default_factory=ExportedCompaction)
    groups: tuple[ExportedGroup, ...] = Field(default=(), max_length=200)


class SettingsEnvelope(_Document):
    """The file itself. It holds nothing readable beyond the format marker."""

    format: Literal["asterism.settings-export"] = SETTINGS_FORMAT
    format_version: Literal[1] = SETTINGS_FORMAT_VERSION
    salt: str
    ciphertext: str


def _fernet(passphrase: str, salt: bytes) -> Fernet:
    # The same passphrase can arrive in different Unicode forms from different keyboards.
    secret = unicodedata.normalize("NFKC", passphrase).encode("utf-8")
    derived = Scrypt(salt=salt, length=32, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P).derive(secret)
    return Fernet(base64.urlsafe_b64encode(derived))


def seal(bundle: SettingsBundle, passphrase: str) -> SettingsEnvelope:
    """Encrypt a bundle. Slow on purpose, so call it off the event loop."""
    salt = os.urandom(_SALT_BYTES)
    token = _fernet(passphrase, salt).encrypt(bundle.model_dump_json().encode("utf-8"))
    return SettingsEnvelope(salt=base64.b64encode(salt).decode("ascii"), ciphertext=token.decode("ascii"))


def unseal(envelope: SettingsEnvelope, passphrase: str) -> SettingsBundle:
    """Decrypt a bundle, or raise one error whatever went wrong."""
    try:
        salt = base64.b64decode(envelope.salt, validate=True)
        if len(salt) != _SALT_BYTES:
            raise ValueError("salt length")
        source = _fernet(passphrase, salt).decrypt(envelope.ciphertext.encode("ascii"))
        return SettingsBundle.model_validate_json(source)
    except (InvalidToken, InvalidKey, ValidationError, ValueError) as exc:
        raise BadDataException(_OPEN_FAILED) from exc


def read_envelope(source: str) -> SettingsEnvelope:
    try:
        return SettingsEnvelope.model_validate_json(source)
    except ValidationError as exc:
        raise BadDataException("This is not an Asterism settings file, or it needs a newer version") from exc
