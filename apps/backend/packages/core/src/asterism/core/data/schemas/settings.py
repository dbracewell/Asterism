from typing import Annotated, Literal

from pydantic import BaseModel, Field, JsonValue, WithJsonSchema


class UserSettings(BaseModel):
    theme: Annotated[
        str,
        WithJsonSchema(
            {
                "nullable": False,
                "type": "string",
                "default": "light",
            }
        ),
    ] = Field(default="light")
    font_size: Annotated[
        str,
        WithJsonSchema(
            {
                "nullable": False,
                "type": "string",
                "default": "16px",
            }
        ),
    ] = Field(default="16px")


# ---------------------------------------------------------------------------
# Application settings types
# ---------------------------------------------------------------------------


class LLMProvider(BaseModel):
    name: str
    base_url: str
    api_key: str
    models: list[str]


class ApplicationSettings(BaseModel):
    llm_providers: list[LLMProvider] = Field(default_factory=list)


class Setting(BaseModel):
    key: str
    value: JsonValue


class UpdateSettingValue(BaseModel):
    value: JsonValue


class AdminPermission(BaseModel):
    user_id: str
    permission: Literal["admin", "user"]
