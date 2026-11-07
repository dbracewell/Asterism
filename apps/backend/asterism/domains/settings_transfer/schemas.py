"""Wire schemas for settings transfer; the export response is the file itself."""

from pydantic import BaseModel, ConfigDict, Field, SecretStr

from .documents import MAX_PASSPHRASE_LENGTH, MIN_PASSPHRASE_LENGTH


class SettingsExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    passphrase: SecretStr = Field(min_length=MIN_PASSPHRASE_LENGTH, max_length=MAX_PASSPHRASE_LENGTH)
