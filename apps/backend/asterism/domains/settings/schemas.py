from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from asterism.domains.agent.schemas import AgentProfile


class Llm(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    provider_id: uuid.UUID
    is_active: bool


class ProviderInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    base_url: str
    api_key: str
    id: uuid.UUID


class LlmWithProvider(Llm):
    model_config = ConfigDict(from_attributes=True)
    provider: ProviderInfo


class Provider(ProviderInfo):
    model_config = ConfigDict(from_attributes=True)
    models: list["Llm"]


class LlmDisplayInfo(BaseModel):
    id: uuid.UUID
    name: str
    provider_id: uuid.UUID
    provider_name: str


class ComponentProviderParameters(BaseModel):
    name: str
    parameters: dict[str, str] = Field(default_factory=dict)


class Setting(BaseModel):
    key: str
    value: JsonValue


class UpdateSettingValue(BaseModel):
    value: JsonValue


class BulkUpdateSettingRequest(BaseModel):
    values: dict[str, JsonValue]


class UserSettings(BaseModel):
    theme: str = Field(default="light")
    font_size: str = Field(default="16px")
    models: list[LlmDisplayInfo] = Field(default_factory=list[LlmDisplayInfo])
    default_model_id: uuid.UUID | None = Field(default=None)
    agents: dict[uuid.UUID, AgentProfile] = Field(default_factory=dict)
    default_agent_id: uuid.UUID | None = Field(default=None)

    @property
    def default_agent_profile(self) -> AgentProfile | None:
        if self.default_agent_id is None:
            return None
        return self.agents.get(self.default_agent_id)


class ApplicationSettings(BaseModel):
    llm_providers: list[Provider] = Field(default_factory=list)
    draft_model_id: uuid.UUID | None = None
    web_search_provider: ComponentProviderParameters | None = None
    image_search_provider: ComponentProviderParameters | None = None
