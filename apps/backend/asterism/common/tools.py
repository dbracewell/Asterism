from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Type

from openai.types.chat import ChatCompletionFunctionToolParam
from pydantic import BaseModel

from .authed_user import AuthedUser


class Function(BaseModel):
    name: str
    arguments: str


class ToolCall(BaseModel):
    id: str
    function: Function
    type: Literal["function"] = "function"


class NoArgs(BaseModel):
    pass


@dataclass(frozen=True)
class ToolContext[T: BaseModel | None]:
    args: T
    user: AuthedUser
    user_message: str
    user_files: list[str] = field(default_factory=list)


@dataclass
class LLMTool:
    name: str
    is_async: bool
    schema: ChatCompletionFunctionToolParam
    arg_validator: Type[BaseModel]
    function: Callable[[ToolContext[BaseModel]], Any]


@dataclass(frozen=True)
class ArgDesc:
    description: str


@dataclass
class ToolResult:
    tool_call_id: str
    content: str
    name: str
    raw_result: Any
    is_empty: bool

    def to_message(self):
        return {
            "role": "tool",
            "tool_call_id": self.tool_call_id,
            "content": self.content,
            "name": self.name,
        }
