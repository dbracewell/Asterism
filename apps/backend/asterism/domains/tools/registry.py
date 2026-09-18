from __future__ import annotations

import inspect
import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Type, get_args

from openai.types.chat import (
    ChatCompletionFunctionToolParam,
)
from openai.types.shared_params import FunctionDefinition
from pydantic import BaseModel

import asterism.domains.settings.service as settings_service
from asterism.common.retries import async_retry
from asterism.core.schemas import AuthedUser
from asterism.domains.chat.schemas import Chat
from asterism.domains.components.schemas import ComponentType
from asterism.domains.llm.schemas import LLMClientProtocol, ToolCall, ToolResult
from asterism.domains.settings.schemas import ApplicationSettings
from asterism.domains.tools.schemas import ToolInfo, ToolInfoList


def _parse_tool_call_arguments(arguments: str | None) -> dict[str, Any]:
    if not arguments:
        return {}
    if isinstance(arguments, dict):
        return arguments

    try:
        arguments = re.sub("'$", "", re.sub(r"^'", "", arguments)).strip()
        return json.loads(arguments)
    except json.JSONDecodeError:
        return {"raw_arguments": arguments}


def _parse_result(
    tool_call: ToolCall,
    raw_result: Any,
) -> ToolResult:
    is_empty = False
    if isinstance(raw_result, BaseModel):
        content = raw_result.model_dump_json()
    elif isinstance(raw_result, (dict, list)):
        content = json.dumps(raw_result)
        is_empty = len(raw_result) == 0
    elif isinstance(raw_result, (int, float, bool)):
        content = json.dumps({"result": raw_result})
    elif isinstance(raw_result, str):
        content = json.dumps({"result": raw_result})
        is_empty = len(raw_result) == 0
    elif raw_result is None:
        content = json.dumps({"result": None})
        is_empty = True
    else:
        content = json.dumps({"result": str(raw_result)})
        is_empty = len(str(raw_result)) == 0

    return ToolResult(
        tool_call=tool_call,
        content=content,
        raw_result=raw_result,
        is_empty=is_empty,
    )


@dataclass(frozen=True)
class ToolContext[T: BaseModel | None]:
    args: T
    user: AuthedUser
    user_message: str
    session: Chat
    app_settings: ApplicationSettings
    client: LLMClientProtocol
    user_files: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class LLMTool:
    name: str
    is_async: bool
    description: str
    schema: ChatCompletionFunctionToolParam
    arg_validator: Type[BaseModel]
    function: Callable[[ToolContext[BaseModel]], Any]
    component_type: ComponentType | None = None


class ToolRegistry:
    def __init__(self):
        self.registry: dict[str, LLMTool] = {}

    async def active_tools(self) -> ToolInfoList:
        app_settings = await settings_service.get_app_settings()
        return ToolInfoList(
            items=[
                ToolInfo(
                    name=t.name,
                    description=t.description,
                    component_type=t.component_type,
                )
                for t in self.registry.values()
                if t.name in app_settings.active_tools
            ]
        )

    def tools(self) -> ToolInfoList:
        return ToolInfoList(
            items=[
                ToolInfo(
                    name=t.name,
                    description=t.description,
                    component_type=t.component_type,
                )
                for t in self.registry.values()
            ]
        )

    def schemas(
        self,
        tool_names: list[str] | None = None,
    ) -> list[ChatCompletionFunctionToolParam]:
        if tool_names is None:
            return [llm_tool.schema for llm_tool in self.registry.values()]

        tool_name_set = set(tool_names)
        return [
            llm_tool.schema
            for llm_tool in self.registry.values()
            if llm_tool.name in tool_name_set
        ]

    def __getitem__(self, tool_name: str) -> LLMTool:
        return self.registry[tool_name]

    @staticmethod
    def _exception_to_tool_result(
        ex: BaseException, tool_call: ToolCall
    ) -> ToolResult:
        return ToolResult(
            content=f"Tool failed with exception: {ex}",
            raw_result=ex,
            is_empty=True,
            tool_call=tool_call,
        )

    async def invoke_tool(
        self,
        tool_call: ToolCall,
        user: AuthedUser,
        client: LLMClientProtocol,
        session: Chat,
        user_message: str = "",
        user_files: list[str] = [],
        max_retries: int = 3,
    ) -> ToolResult:
        llm_tool = self.registry[tool_call.function.name]

        @async_retry(
            max_retries=max_retries,
            on_exceed_attempts=lambda ex: (
                ToolRegistry._exception_to_tool_result(ex, tool_call)
            ),
        )
        async def call_tool() -> ToolResult:

            try:
                arguments = llm_tool.arg_validator.model_validate(
                    _parse_tool_call_arguments(tool_call.function.arguments)
                )
            except Exception as e:
                return ToolRegistry._exception_to_tool_result(e, tool_call)

            ctx = ToolContext(
                args=arguments,
                user=user,
                session=session,
                user_message=user_message,
                user_files=user_files,
                client=client,
                app_settings=await settings_service.get_app_settings(),
            )

            if llm_tool.is_async:
                raw_result = await llm_tool.function(ctx)
            else:
                raw_result = llm_tool.function(ctx)

            return _parse_result(
                tool_call=tool_call,
                raw_result=raw_result,
            )

        return await call_tool()

    def tool(
        self,
        name: str | None = None,
        description: str | None = None,
        component_type: ComponentType | None = None,
    ) -> Callable[..., Callable[[ToolContext[BaseModel]], Any]]:
        def to_json_schema(
            func: Callable[[ToolContext[BaseModel]], Any],
            func_name: str,
            func_description: str,
        ) -> tuple[Type[BaseModel], ChatCompletionFunctionToolParam]:
            sig = inspect.signature(func)
            annotation = next(iter(sig.parameters.values())).annotation
            type_arguments = get_args(annotation)
            if not type_arguments:
                raise ValueError("Context is missing the generic Args type")
            args_class = type_arguments[0]
            param_schema = args_class.model_json_schema()
            param_schema["additionalProperties"] = False
            param_schema["required"] = list(args_class.model_fields.keys())
            function_schema = ChatCompletionFunctionToolParam(
                type="function",
                function=FunctionDefinition(
                    name=func_name,
                    description=func_description,
                    strict=True,
                    parameters=param_schema,
                ),
            )
            return args_class, function_schema

        def decorator(
            func: Callable[[ToolContext[BaseModel]], Any],
        ) -> Callable[[ToolContext[BaseModel]], Any]:
            def wrapper(*args, **kwargs):
                return func(*args, **kwargs)

            tool_name = name or func.__name__  # type: ignore
            is_async = inspect.iscoroutinefunction(func)
            tool_desc = description or (inspect.getdoc(func) or "").strip()
            arg_validator, schema = to_json_schema(func, tool_name, tool_desc)
            self.registry[tool_name] = LLMTool(
                name=tool_name,
                description=tool_desc,
                arg_validator=arg_validator,
                is_async=is_async,
                schema=schema,
                function=func,
                component_type=component_type,
            )
            return wrapper

        return decorator


tool_registry = ToolRegistry()
