import uuid

from pydantic import BaseModel, Field

from .chat_parameters import ChatCompletionParams


class AgentProfile(BaseModel):
    id: uuid.UUID
    user_id: str
    name: str
    description: str
    model_id: uuid.UUID
    system_prompt: str | None = Field(default=None)
    max_steps: int = Field(default=3)
    chat_parameters: ChatCompletionParams = Field(
        default_factory=ChatCompletionParams
    )
    tools: list[str] | None = Field(default=None)
