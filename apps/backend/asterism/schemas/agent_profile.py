import uuid

from pydantic import BaseModel, ConfigDict, Field

from asterism.common.chat_parameters import ChatCompletionParams


class PartialAgentProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: str
    name: str
    description: str
    model_id: uuid.UUID
    system_prompt: str | None
    max_steps: int
    chat_parameters: ChatCompletionParams = Field(default_factory=ChatCompletionParams)
    tools: list[str] | None = Field(
        default_factory=lambda: [
            "get_user_name",
            "get_current_timestamp",
            "get_timestamp_at_timezone",
        ]
    )
    id: uuid.UUID | None = None


class AgentProfile(PartialAgentProfile):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID


class UserAgents(BaseModel):
    agents: dict[uuid.UUID, AgentProfile]
