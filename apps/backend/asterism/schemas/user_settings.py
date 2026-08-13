from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from .agent_profile import AgentProfile
from .provider import LLMModelInfo


class UserSettingsModel(BaseModel):
    theme: str = Field(default="light")
    font_size: str = Field(default="16px")
    models: list[LLMModelInfo] = Field(default_factory=list[LLMModelInfo])
    default_model_id: uuid.UUID | None = Field(default=None)
    agents: dict[uuid.UUID, AgentProfile] = Field(default_factory=dict)
    default_agent_id: uuid.UUID | None = Field(default=None)

    @property
    def default_agent_profile(self) -> AgentProfile | None:
        return self.agents.get(self.default_agent_id) if self.default_agent_id else None

    @property
    def default_model(self) -> LLMModelInfo | None:
        return (
            next(
                (m for m in self.models if m.id == self.default_model_id),
                None,
            )
            if self.default_model_id
            else None
        )
