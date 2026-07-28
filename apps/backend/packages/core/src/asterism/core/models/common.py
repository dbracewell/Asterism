from pydantic import BaseModel


class LLMModel(BaseModel):
    provider_id: str
    name: str


class LLMProviderModel(BaseModel):
    name: str
    is_active: bool


class LLMProvider(BaseModel):
    id: str
    name: str
    base_url: str
    api_key: str
    models: list[LLMProviderModel]


class DraftModel(BaseModel):
    repo_id: str
    filename: str
