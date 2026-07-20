from typing import Annotated

from pydantic import BaseModel, WithJsonSchema


class LLMConfiguration(BaseModel):
    base_url: str
    api_key: str
    provider: str


class ApplicationSettings(BaseModel):
    llms: list[LLMConfiguration]


class UserSettings(BaseModel):
    theme: Annotated[
        str,
        WithJsonSchema(
            {
                "nullable": False,
                "type": "string",
                "default": "dark",
            }
        ),
    ] = "dark"
