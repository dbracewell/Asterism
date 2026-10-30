"""Pydantic schemas for settings API payloads and ORM-to-API mapping.

``Llm``/``ProviderInfo`` double as response models (``from_attributes=True``)
and request validation. Capability provenance is normalized in validators so
the invariants "value missing ⇒ source UNKNOWN" and "value present with no
source ⇒ MANUAL" hold on every object that leaves the service layer.
"""

from __future__ import annotations

import uuid

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    PositiveInt,
    SecretStr,
    StrictBool,
    field_serializer,
    model_validator,
)

from asterism.domains.agent.schemas import MainAgentConfiguration, SubAgentDefinition

from .provider_types import (
    ModelCapabilitySource,
    ProviderType,
    normalize_provider_base_url,
)
from .secrets import redact_component_parameters


def normalize_capability_source(
    value: int | bool | None,
    source: ModelCapabilitySource,
) -> ModelCapabilitySource:
    """Coerce a capability value/source pair into a consistent state.

    A missing value has no provenance (``UNKNOWN``); a present value that
    claims no provenance must have been entered by hand (``MANUAL``).
    """
    if value is None:
        return ModelCapabilitySource.UNKNOWN
    if source == ModelCapabilitySource.UNKNOWN:
        return ModelCapabilitySource.MANUAL
    return source


class Llm(BaseModel):
    """A provider model with capability flags and their provenance."""

    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    provider_id: uuid.UUID
    is_active: bool
    context_window: PositiveInt | None = None
    supports_vision: bool | None = None
    supports_tools: bool | None = None
    tools_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    context_window_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    vision_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN

    @model_validator(mode="after")
    def normalize_capability_sources(self) -> "Llm":
        """Keep every capability value/source pair consistent (see :func:`normalize_capability_source`)."""
        self.context_window_source = normalize_capability_source(
            self.context_window,
            self.context_window_source,
        )
        self.vision_source = normalize_capability_source(
            self.supports_vision,
            self.vision_source,
        )
        self.tools_source = normalize_capability_source(self.supports_tools, self.tools_source)
        return self


class ProviderInfo(BaseModel):
    """Provider identity and connection details without its model list.

    ``api_key`` is a :class:`SecretStr`, so JSON serialization redacts it to
    ``**********`` automatically; the service layer treats that exact string as
    "keep the existing stored key" on updates (see ``service._provider_api_key``).
    """

    model_config = ConfigDict(from_attributes=True)
    name: str
    base_url: str
    api_key: SecretStr
    id: uuid.UUID
    provider_type: ProviderType = ProviderType.GENERIC_OPENAI

    @model_validator(mode="after")
    def normalize_base_url(self) -> "ProviderInfo":
        """Re-normalize the base URL so stored/returned values match runtime form."""
        self.base_url = normalize_provider_base_url(
            self.provider_type,
            self.base_url,
        )
        return self


class LlmWithProvider(Llm):
    """A model plus its provider (used to resolve a concrete model for execution)."""

    provider: ProviderInfo


class Provider(ProviderInfo):
    """Full provider configuration including its models."""

    models: list["Llm"]


class ProviderSummary(ProviderInfo):
    """Provider configuration returned by the Providers settings landing page."""

    model_count: int = 0
    active_model_count: int = 0


class LlmDisplayInfo(BaseModel):
    """Flat, denormalized model view (includes ``provider_name``) for pickers and lists."""

    id: uuid.UUID
    name: str
    provider_id: uuid.UUID
    provider_name: str
    provider_type: ProviderType
    context_window: PositiveInt | None = None
    supports_vision: bool | None = None
    supports_tools: bool | None = None
    tools_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    context_window_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    vision_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN


class ComponentProviderParameters(BaseModel):
    """A named component provider (e.g. web search) plus its string parameters.

    JSON serialization redacts values whose keys look like secrets, so API
    responses never echo stored credentials.
    """

    name: str
    parameters: dict[str, str] = Field(default_factory=dict)

    @field_serializer("parameters", when_used="json")
    def _redact_secrets_for_json(self, parameters: dict[str, str]) -> dict[str, str]:
        return redact_component_parameters(parameters)


class Setting(BaseModel):
    """A single key/value setting row."""

    key: str
    value: JsonValue


class UpdateSettingValue(BaseModel):
    """Payload for updating one setting by key (``value`` of ``None`` deletes it)."""

    value: JsonValue


class BulkUpdateSettingRequest(BaseModel):
    """Payload for updating several settings at once, keyed by setting name."""

    values: dict[str, JsonValue]


class UserSettings(BaseModel):
    """Aggregate of one user's settings as returned by ``GET /settings/user``.

    ``main_agent``/``sub_agents`` are injected by the service from the agent
    domain; ``models`` is the list of all active models across providers.
    """

    theme: str = Field(default="atlas")
    font_size: str = Field(default="16px")
    models: list[LlmDisplayInfo] = Field(default_factory=list[LlmDisplayInfo])
    default_model_id: uuid.UUID | None = Field(default=None)
    main_agent: MainAgentConfiguration
    sub_agents: dict[uuid.UUID, SubAgentDefinition] = Field(default_factory=dict)
    show_thinking: bool = Field(default=True)


class ApplicationSettings(BaseModel):
    """Aggregate of global application settings (admin view)."""

    skills_enabled: StrictBool = False
    chatgpt_plan_enabled: StrictBool = False
    llm_providers: list[Provider] = Field(default_factory=list)
    draft_model_id: uuid.UUID | None = None
    web_search_provider: ComponentProviderParameters | None = None
    image_search_provider: ComponentProviderParameters | None = None
    active_tools: list[str]


class ProviderSettings(BaseModel):
    """Provider landing-page payload: provider summaries plus the selected draft model."""

    llm_providers: list[ProviderSummary] = Field(default_factory=list)
    draft_model_id: uuid.UUID | None = None
    draft_model: LlmDisplayInfo | None = None


class ProviderModelsPage(BaseModel):
    """One keyset-paginated page of a provider's models (``next_cursor`` is a model id)."""

    models: list[Llm] = Field(default_factory=list)
    next_cursor: str | None = None
    total: int = 0


class ProviderModelUpdate(BaseModel):
    """Full-replacement payload for one model's flags and capabilities."""

    is_active: bool
    context_window: PositiveInt | None = None
    supports_vision: bool | None = None
    supports_tools: bool | None = None
    tools_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    context_window_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    vision_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN

    @model_validator(mode="after")
    def normalize_capability_sources(self) -> "ProviderModelUpdate":
        """Keep every capability value/source pair consistent (see :func:`normalize_capability_source`)."""
        self.context_window_source = normalize_capability_source(
            self.context_window,
            self.context_window_source,
        )
        self.vision_source = normalize_capability_source(
            self.supports_vision,
            self.vision_source,
        )
        self.tools_source = normalize_capability_source(self.supports_tools, self.tools_source)
        return self


class ToolSettings(BaseModel):
    """Admin tool configuration: enabled tools plus component provider selections."""

    web_search_provider: ComponentProviderParameters | None = None
    image_search_provider: ComponentProviderParameters | None = None
    active_tools: list[str] = Field(default_factory=list)
