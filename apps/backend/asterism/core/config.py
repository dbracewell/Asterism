import os
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

secrets_dir = Path("/run/secrets")
_FULL_RUNTIME_PROFILES = {"development", "production"}
_RUNTIME_PROFILES = _FULL_RUNTIME_PROFILES | {"backend-init", "reset"}
_PROFILES = _RUNTIME_PROFILES | {"auth-migrate", "build", "test", "codegen"}
_PLACEHOLDER_PREFIXES = (
    "replace-with-",
    "build-only-placeholder",
    "test-only-",
    "disposable-",
)


def _file_secret(name: str) -> str:
    canonical = secrets_dir / name
    entries = {path.name for path in secrets_dir.iterdir()} if secrets_dir.exists() else set()
    has_canonical = name in entries
    has_legacy = name.lower() in entries
    if has_canonical and has_legacy:
        raise ValueError(
            f"Ambiguous file secret names for {name}; keep only the uppercase file"  # noqa: E501
        )
    if has_legacy:
        raise ValueError(f"Legacy file secret name for {name}; rename it to uppercase")
    if not has_canonical:
        return ""
    return canonical.read_text().removesuffix("\n").removesuffix("\r")


def default_allowed_tools() -> list[str]:
    return [
        "get_user_name",
        "get_current_timestamp",
        "get_timestamp_at_timezone",
        "sub_agent",
    ]


def _valid_origin(value: str, production: bool) -> bool:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return False
    if parsed.path not in {"", "/"} or value.endswith("/"):
        return False
    loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    return not (production and parsed.scheme != "https" and not loopback)


class ConfigValidationError(RuntimeError):
    pass


class Config(BaseSettings):
    system_key: str = Field(default_factory=lambda: _file_secret("SYSTEM_KEY"))
    """System key used for signing JWTs and other internal secrets (value redacted)."""

    max_chars_for_retrieval: int = 50000
    """The maximum number of characters to retrieve from a document for context."""

    max_upload_file_size_bytes: int = 100 * 1024 * 1024
    """The maximum size of a file that can be uploaded (in bytes)."""

    max_process_file_size_bytes: int = 100 * 1024 * 1024
    """The maximum size of a file that can be processed (in bytes)."""

    max_converted_chars: int = 100_000
    """The maximum number of characters that can be converted from a file."""

    file_conversion_timeout_s: int = 60
    """The maximum time (in seconds) to wait for a file conversion to complete."""

    max_vision_image_bytes: int = 10 * 1024 * 1024
    """The maximum size of an image that can be processed for vision tasks (in bytes)."""

    public_url: str = "http://localhost:3000"
    """The public URL of the Asterism frontend, used for JWT issuer and audience."""

    cors_allowed_origins: list[str] | None = None
    """List of allowed origins for CORS. If None, defaults to [public_url]."""

    storage_root: Path = Path("/storage")
    """The root directory for storing files and other data."""

    db_url: str | None = None
    """The database URL. If None, defaults to a SQLite database in storage_root."""

    default_allowed_tools: list[str] = Field(default_factory=default_allowed_tools)
    """List of default allowed tools for agents."""

    max_sub_agent_depth: int = 3
    """The maximum depth of sub-agent calls to prevent infinite recursion."""

    max_concurrent_llm_requests: int = 8
    """Maximum concurrent streaming requests across all configured LLM providers."""

    sub_agent_context_window_messages: int = 10
    """The maximum number of messages to include in the context window for sub-agents."""

    sub_agent_context_window_tokens: int = 4000
    """The maximum number of tokens to include in the context window for sub-agents."""

    config_profile: str = Field(
        default_factory=lambda: "production" if os.environ.get("NODE_ENV") == "production" else "development",
        validation_alias="ASTERISM_CONFIG_PROFILE",
        exclude=True,
    )
    """The configuration profile, which can be one of the following: development, production, backend-init, reset, auth-migrate, build, test, codegen."""  # noqa: E501

    model_config = SettingsConfigDict(extra="ignore", populate_by_name=True)

    @model_validator(mode="after")
    def finalize(self):
        if self.config_profile in _RUNTIME_PROFILES and not self.storage_root.is_absolute():
            raise ValueError("STORAGE_ROOT must be an absolute path")
        self.storage_root = self.storage_root.resolve()
        if not self.db_url:
            self.db_url = f"sqlite+aiosqlite:///{self.storage_root}/database.db"
        if not self.cors_allowed_origins:
            self.cors_allowed_origins = [self.public_url]

        return self

    def validate_runtime(self) -> None:
        if self.config_profile not in _PROFILES:
            raise ConfigValidationError(f"ASTERISM_CONFIG_PROFILE is unknown: {self.config_profile}")
        if self.config_profile not in _RUNTIME_PROFILES:
            return
        if self.config_profile in _FULL_RUNTIME_PROFILES:
            if not _valid_origin(
                self.public_url,
                production=self.config_profile == "production",
            ):
                raise ConfigValidationError(
                    "PUBLIC_URL must be an absolute browser-facing origin "
                    "without credentials, path, query, fragment, or trailing slash"  # noqa: E501
                )
            if not self.system_key:
                raise ConfigValidationError("SYSTEM_KEY is required (value redacted)")
            if self.system_key.startswith(_PLACEHOLDER_PREFIXES):
                raise ConfigValidationError("SYSTEM_KEY uses a known placeholder (value redacted)")
            if self.config_profile == "production" and len(self.system_key) < 32:
                raise ConfigValidationError(
                    "SYSTEM_KEY does not meet the production strength requirement (value redacted)"
                )
        if not 1 <= self.max_chars_for_retrieval <= 1_000_000:
            raise ConfigValidationError("MAX_CHARS_FOR_RETRIEVAL must be from 1 to 1000000")
        if not 1 <= self.max_upload_file_size_bytes <= 100 * 1024 * 1024:
            raise ConfigValidationError("MAX_UPLOAD_FILE_SIZE_BYTES must be from 1 to 104857600")
        if not 1 <= self.max_process_file_size_bytes <= self.max_upload_file_size_bytes:
            raise ConfigValidationError("MAX_PROCESS_FILE_SIZE_BYTES must be from 1 to MAX_UPLOAD_FILE_SIZE_BYTES")
        if not 1 <= self.max_converted_chars <= 1_000_000:
            raise ConfigValidationError("MAX_CONVERTED_CHARS must be from 1 to 1000000")
        if not 1 <= self.file_conversion_timeout_s <= 600:
            raise ConfigValidationError("FILE_CONVERSION_TIMEOUT_S must be from 1 to 600")
        if not 1 <= self.max_vision_image_bytes <= self.max_upload_file_size_bytes:
            raise ConfigValidationError("MAX_VISION_IMAGE_BYTES must be from 1 to MAX_UPLOAD_FILE_SIZE_BYTES")
        if not 1 <= self.max_concurrent_llm_requests <= 128:
            raise ConfigValidationError("MAX_CONCURRENT_LLM_REQUESTS must be from 1 to 128")
        if self.config_profile in _FULL_RUNTIME_PROFILES and any(
            origin == "*" for origin in self.cors_allowed_origins or []
        ):
            raise ConfigValidationError("CORS_ALLOWED_ORIGINS cannot contain a wildcard")
        if self.db_url and not self.db_url.startswith("sqlite+aiosqlite:////"):
            raise ConfigValidationError("DB_URL must use SQLite with an absolute path (URL redacted)")

    def prepare_storage(self) -> None:
        self.storage_root.mkdir(exist_ok=True, parents=True)
        self.files_root.mkdir(exist_ok=True, parents=True)

    @property
    def jwt_issuer(self) -> str:
        return self.public_url

    @property
    def jwt_audience(self) -> str:
        return self.public_url

    @property
    def frontend_internal_url(self) -> str:
        # Next.js in development, nginx in the combined container.
        return "http://127.0.0.1:3000"

    @property
    def jwks_url(self) -> str:
        return f"{self.frontend_internal_url}/api/auth/jwks"

    @computed_field
    @property
    def files_root(self) -> Path:
        return self.storage_root / "files"

    def get_user_file(self, user_id: str, filename: str) -> Path:
        files_dir = self.files_root / user_id / filename
        return files_dir.resolve()


config = Config()
config.validate_runtime()
