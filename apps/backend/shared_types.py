from pydantic import BaseModel, Field


class AIMessagePart(BaseModel):
    type: str
    text: str


class AIMessage(BaseModel):
    role: str
    parts: list[AIMessagePart]


class ChatRequest(BaseModel):
    model: str
    available_tools: list[str] = Field(default_factory=list)
    messages: list[AIMessage]
