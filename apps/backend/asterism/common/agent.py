import uuid

from pydantic import BaseModel, Field

from .chat_parameters import ChatCompletionParams
from .llm_models import LLMModel


class AgentProfile(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    model: LLMModel
    system_prompt: str | None = Field(default=None)
    max_steps: int = Field(default=3)
    chat_parameters: ChatCompletionParams = Field(
        default_factory=ChatCompletionParams
    )
    tools: list[str] = Field(default_factory=list)
