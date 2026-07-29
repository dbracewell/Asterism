from pydantic import BaseModel


class LLMModel(BaseModel):
    provider_id: str
    name: str

    def __eq__(self, other: object) -> bool:
        if isinstance(other, LLMModel):
            return (
                self.name == other.name
                and self.provider_id == other.provider_id
            )
        return False


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
