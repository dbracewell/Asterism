"""Wire schemas for settings transfer; the export response is the file itself."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr

from .documents import MAX_PASSPHRASE_LENGTH, MAX_SETTINGS_FILE_BYTES, MIN_PASSPHRASE_LENGTH


class SettingsExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    passphrase: SecretStr = Field(min_length=MIN_PASSPHRASE_LENGTH, max_length=MAX_PASSPHRASE_LENGTH)


class SettingsImportRequest(BaseModel):
    """Preview and import both open the file from scratch; nothing is held between."""

    model_config = ConfigDict(extra="forbid")

    source: str = Field(min_length=1, max_length=MAX_SETTINGS_FILE_BYTES)
    passphrase: SecretStr = Field(min_length=1, max_length=MAX_PASSPHRASE_LENGTH)


class ProviderChange(BaseModel):
    name: str
    action: Literal["add", "update"]
    models_added: int
    models_updated: int


class SettingsImportSummary(BaseModel):
    """What an import changes. It holds no keys or parameter values."""

    exported_at: int
    providers: list[ProviderChange]
    kept_providers: list[str]
    changed_settings: list[str]
