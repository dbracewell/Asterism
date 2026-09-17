from pathlib import Path

from pydantic import Field, computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

secrets_dir = Path("/run/secrets")


def default_allowed_tools() -> list[str]:
    return [
        "get_user_name",
        "get_current_timestamp",
        "get_timestamp_at_timezone",
    ]


class Config(BaseSettings):
    system_key: str = ""
    max_chars_for_retrieval: int = 50000
    public_url: str = "http://localhost:3000"
    cors_allowed_origins: list[str] | None = None
    storage_root: Path = Path("/storage")
    db_url: str | None = None
    default_allowed_tools: list[str] = Field(
        default_factory=default_allowed_tools
    )

    model_config = SettingsConfigDict(
        secrets_dir=str(secrets_dir) if secrets_dir.exists() else None,
        extra="ignore",
    )

    @model_validator(mode="after")
    def validate(self):
        self.storage_root = self.storage_root.resolve()
        self.storage_root.mkdir(exist_ok=True, parents=True)

        if not self.db_url:
            self.db_url = f"sqlite+aiosqlite:///{self.storage_root}/database.db"

        if not self.cors_allowed_origins:
            self.cors_allowed_origins = [self.public_url]

        return self

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
        files_root = self.storage_root / "files"
        files_root.mkdir(exist_ok=True)
        return files_root

    def get_user_file(self, user_id: str, filename: str) -> Path:
        files_dir = self.files_root / user_id / filename
        return files_dir.resolve()


config = Config()
