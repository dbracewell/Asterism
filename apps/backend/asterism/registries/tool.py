import inspect
import json
import re
from typing import (
    Any,
    Callable,
    Type,
    get_args,
)

from openai.types.chat import (
    ChatCompletionFunctionToolParam,
)
from openai.types.shared_params import FunctionDefinition
from pydantic import BaseModel

from asterism.common import (
    AuthedUser,
    LLMTool,
    ToolCall,
    ToolContext,
    ToolResult,
)
from asterism.utils.retries import async_retry


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
    tool_call_id: str,
    function_name: str,
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
        tool_call_id=tool_call_id,
        content=content,
        name=function_name,
        raw_result=raw_result,
        is_empty=is_empty,
    )


class ToolRegistry:
    def __init__(self):
        self.registry: dict[str, LLMTool] = {}

    def tools(self) -> list[str]:
        return list(self.registry.keys())

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

    async def invoke_tool(
        self,
        tool_call: ToolCall,
        user: AuthedUser,
        user_message: str = "",
        user_files: list[str] = [],
        max_retries: int = 3,
    ) -> ToolResult:
        llm_tool = self.registry[tool_call.function.name]

        @async_retry(
            max_retries=max_retries,
            on_exceed_attempts=lambda last_exception: Exception(
                f"Tool '{tool_call.function.name}' failed after {max_retries} "
                "attempts.\n"
                f"Arguments: {tool_call.function.arguments}\n"
                f"Error: {last_exception}",
            ),
        )
        async def call_tool():
            try:
                arguments = llm_tool.arg_validator.model_validate(
                    _parse_tool_call_arguments(tool_call.function.arguments)
                )
            except Exception as e:
                raise RuntimeError(e)

            ctx = ToolContext(
                args=arguments,
                user=user,
                user_message=user_message,
                user_files=user_files,
            )

            if llm_tool.is_async:
                raw_result = await llm_tool.function(ctx)
            else:
                raw_result = llm_tool.function(ctx)

            return _parse_result(
                tool_call_id=tool_call.id,
                function_name=tool_call.function.name,
                raw_result=raw_result,
            )

        return await call_tool()

    def tool(
        self,
        name: str | None = None,
        description: str | None = None,
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
            function_schema = ChatCompletionFunctionToolParam(
                type="function",
                function=FunctionDefinition(
                    name=func_name,
                    description=func_description,
                    strict=True,
                    parameters=args_class.model_json_schema(),
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
            self.registry[tool_name] = LLMTool(  # type:ignore
                name=tool_name,
                arg_validator=arg_validator,
                is_async=is_async,
                schema=schema,
                function=func,
            )
            return wrapper

        return decorator


tool_registry = ToolRegistry()
