import uuid

from pydantic import BaseModel, ConfigDict


class LLMProviderInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    base_url: str
    api_key: str
    id: uuid.UUID


class LLMProvider(LLMProviderInfo):
    model_config = ConfigDict(from_attributes=True)
    models: list["LLMModel"]


class LLMProviderList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    items: list[LLMProvider]


class LLMModelInfo(BaseModel):
    id: uuid.UUID
    name: str
    provider_id: uuid.UUID
    provider_name: str


class LLMModelInfoList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    items: list[LLMModelInfo]


class LLMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    provider_id: uuid.UUID
    name: str
    is_active: bool


class LLMModelWithProvider(LLMModel):
    model_config = ConfigDict(from_attributes=True)
    provider: LLMProviderInfo
