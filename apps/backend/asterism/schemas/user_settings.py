from pydantic import BaseModel, Field

from asterism.common import LLMModel


class UserSettingsModel(BaseModel):
    theme: str = Field(default="light")
    font_size: str = Field(default="16px")
    models: list[LLMModel] = Field(default_factory=list[LLMModel])
    chat_model: LLMModel | None = Field(default=None)
