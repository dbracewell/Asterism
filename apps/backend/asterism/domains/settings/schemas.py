from __future__ import annotations

import uuid

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    PositiveInt,
    model_validator,
)

from asterism.core.exceptions import BadDataException
from asterism.domains.agent.schemas import AgentProfile

from .provider_types import (
    ModelCapabilitySource,
    ProviderType,
    normalize_provider_base_url,
)


class Llm(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    provider_id: uuid.UUID
    is_active: bool
    context_window: PositiveInt | None = None
    supports_vision: bool | None = None
    context_window_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    vision_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN

    @model_validator(mode="after")
    def normalize_capability_sources(self) -> "Llm":
        self.context_window_source = self._normalized_source(
            self.context_window,
            self.context_window_source,
        )
        self.vision_source = self._normalized_source(
            self.supports_vision,
            self.vision_source,
        )
        return self

    @staticmethod
    def _normalized_source(
        value: int | bool | None,
        source: ModelCapabilitySource,
    ) -> ModelCapabilitySource:
        if value is None:
            return ModelCapabilitySource.UNKNOWN
        if source == ModelCapabilitySource.UNKNOWN:
            return ModelCapabilitySource.MANUAL
        return source


class ProviderInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str
    base_url: str
    api_key: str
    id: uuid.UUID
    provider_type: ProviderType = ProviderType.GENERIC_OPENAI

    @model_validator(mode="after")
    def normalize_base_url(self) -> "ProviderInfo":
        self.base_url = normalize_provider_base_url(
            self.provider_type,
            self.base_url,
        )
        return self


class LlmWithProvider(Llm):
    model_config: ConfigDict = ConfigDict(from_attributes=True)
    provider: ProviderInfo


class Provider(ProviderInfo):
    model_config = ConfigDict(from_attributes=True)
    models: list["Llm"]


class LlmDisplayInfo(BaseModel):
    id: uuid.UUID
    name: str
    provider_id: uuid.UUID
    provider_name: str
    context_window: PositiveInt | None = None
    supports_vision: bool | None = None
    context_window_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    vision_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN


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
    def default_agent_profile(self) -> AgentProfile:
        if not self.default_agent_id:
            raise BadDataException("User does not have a default agent profile set.")
        agent: AgentProfile | None = self.agents.get(self.default_agent_id)
        if agent is None:
            raise BadDataException("User does not have a default agent profile set.")
        return agent


class ApplicationSettings(BaseModel):
    llm_providers: list[Provider] = Field(default_factory=list)
    draft_model_id: uuid.UUID | None = None
    web_search_provider: ComponentProviderParameters | None = None
    image_search_provider: ComponentProviderParameters | None = None
    active_tools: list[str]
