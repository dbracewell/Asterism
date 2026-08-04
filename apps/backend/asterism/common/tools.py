from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Literal, Type

from openai.types.chat import ChatCompletionFunctionToolParam
from pydantic import BaseModel

from .authed_user import AuthedUser

if TYPE_CHECKING:
    from asterism.llm import LLMClient
    from asterism.schemas import ApplicationSettingsModel


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
    app_settings: ApplicationSettingsModel
    client: LLMClient
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
    content: str
    raw_result: Any
    is_empty: bool
    tool_call: ToolCall
