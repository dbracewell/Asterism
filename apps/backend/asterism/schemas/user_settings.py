import uuid

from pydantic import BaseModel, Field

from asterism.common import AgentProfile, LLMModel


class UserSettingsModel(BaseModel):
    theme: str = Field(default="light")
    font_size: str = Field(default="16px")
    models: dict[str, LLMModel] = Field(default_factory=dict[str, LLMModel])
    default_model_id: str | None = Field(default=None)
    agents: dict[uuid.UUID, AgentProfile] = Field(
        default_factory=dict[uuid.UUID, AgentProfile]
    )
    default_agent_id: uuid.UUID | None = Field(default=None)

    @property
    def default_agent_profile(self) -> AgentProfile | None:
        return (
            self.agents.get(self.default_agent_id)
            if self.default_agent_id
            else None
        )

    @property
    def default_model(self) -> LLMModel | None:
        return (
            self.models.get(self.default_model_id)
            if self.default_model_id
            else None
        )
