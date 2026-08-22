from __future__ import annotations

import uuid
from typing import Self

from pydantic import BaseModel, ConfigDict, Field

from asterism.domains.llm.schemas import ChatCompletionParams


class PartialAgentProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="ignore")
    name: str
    description: str
    model_id: uuid.UUID
    system_prompt: str | None
    max_steps: int
    chat_parameters: ChatCompletionParams = Field(
        default_factory=ChatCompletionParams,
    )
    tools: list[str] | None = Field(
        default_factory=lambda: [
            "get_user_name",
            "get_current_timestamp",
            "get_timestamp_at_timezone",
        ]
    )
    id: uuid.UUID | None = None

    @classmethod
    def create_default_agent(
        cls,
        model_id: uuid.UUID,
    ) -> Self:
        return cls(
            model_id=model_id,
            max_steps=5,
            description="A default agent to answer the user's requests",
            name="Default agent",
            system_prompt=(
                "You are a helpful agent here to assist "
                "the user in their information needs."
            ),
        )


class AgentProfile(PartialAgentProfile):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID = uuid.uuid4()


class UserAgents(BaseModel):
    agents: dict[uuid.UUID, AgentProfile]
