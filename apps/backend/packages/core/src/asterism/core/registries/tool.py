import inspect
import json
import re
from dataclasses import dataclass
from typing import (
    Annotated,
    Any,
    Callable,
    Literal,
    Type,
    get_args,
    get_origin,
    get_type_hints,
)

from openai.types.chat import ChatCompletionFunctionToolParam
from openai.types.shared_params import FunctionDefinition
from pydantic import BaseModel, ConfigDict, Field
from pydantic.json_schema import DEFAULT_REF_TEMPLATE

from asterism.core.typedefs import AuthedUser
from asterism.core.utils.retries import async_retry


class Function(BaseModel):
    name: str
    arguments: str


class ToolCall(BaseModel):
    id: str
    function: Function
    type: Literal["function"] = "function"


@dataclass
class LLMTool:
    name: str
    is_async: bool
    schema: ChatCompletionFunctionToolParam
    arg_validator: Type[BaseModel]
    function: Callable[..., Any]
    user_param: str | None


@dataclass(frozen=True)
class ArgDesc:
    description: str


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
                json_arguments = llm_tool.arg_validator.model_validate(
                    _parse_tool_call_arguments(tool_call.function.arguments)
                ).model_dump()
            except Exception as e:
                raise RuntimeError(e)

            if llm_tool.user_param:
                json_arguments[llm_tool.user_param] = user

            if llm_tool.is_async:
                raw_result = await llm_tool.function(**json_arguments)
            else:
                raw_result = llm_tool.function(**json_arguments)

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
    ):
        def to_json_schema(
            func: Callable[..., Any],
            func_name: str,
            func_description: str,
        ) -> tuple[Type[BaseModel], str | None, ChatCompletionFunctionToolParam]:
            """
            Converts a Python function with type hints (including typing.Annotated)
            into a JSON Schema by dynamically creating a Pydantic Model correctly.
            """

            sig = inspect.signature(func)
            type_hints = get_type_hints(func, include_extras=True)
            field_definitions = {}  # Stores {name: FieldInfo}
            annotations = {}  # Stores {name: base_type}
            user_param = None
            for (param_name, param_annotation), param in zip(
                type_hints.items(),
                sig.parameters.values(),
            ):
                parameter_description = None

                if param_annotation is AuthedUser:
                    user_param = param_name
                    continue
                if get_origin(param_annotation) is not Annotated:
                    raise ValueError(
                        "Arguments must be annotated with typing.Annotated"
                    )

                base_type, *metadata = get_args(param_annotation)
                for item in metadata:
                    if isinstance(item, ArgDesc):
                        parameter_description = str(item)
                        break

                field_kwargs = {}

                if param.default is param.empty:
                    field_kwargs["default"] = ...
                else:
                    field_kwargs["default"] = param.default

                if description:
                    field_kwargs["description"] = parameter_description

                annotations[param_name] = base_type
                field_definitions[param_name] = Field(**field_kwargs)  # type: ignore

            ParamModel = type(
                "ParamModel",
                (BaseModel,),
                {
                    "__annotations__": annotations,
                    **field_definitions,
                    "model_config": ConfigDict(extra="ignore"),
                },
            )

            # Generate the JSON Schema
            param_schema = ParamModel.model_json_schema(  # type: ignore
                ref_template=DEFAULT_REF_TEMPLATE,
            )

            # Clean up and structure the schema for function calling
            properties_schema = {
                "type": "object",
                "properties": param_schema.get("properties", {}),
                "required": param_schema.get("required", []),
            }

            if "$defs" in param_schema:
                properties_schema["$defs"] = param_schema["$defs"]

            properties_schema["additionalProperties"] = False
            function_schema = ChatCompletionFunctionToolParam(
                type="function",
                function=FunctionDefinition(
                    name=func_name,
                    description=func_description,
                    strict=True,
                    parameters=properties_schema,
                ),
            )

            return ParamModel, user_param, function_schema  # type: ignore

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            def wrapper(*args, **kwargs):
                return func(*args, **kwargs)

            tool_name = name or func.__name__  # type: ignore
            is_async = inspect.iscoroutinefunction(func)
            tool_desc = description or (inspect.getdoc(func) or "").strip()
            arg_validator, user_param, schema = to_json_schema(
                func, tool_name, tool_desc
            )
            self.registry[tool_name] = LLMTool(  # type:ignore
                name=tool_name,
                arg_validator=arg_validator,
                is_async=is_async,
                schema=schema,
                function=func,
                user_param=user_param,
            )
            return wrapper

        return decorator


tool_registry = ToolRegistry()
