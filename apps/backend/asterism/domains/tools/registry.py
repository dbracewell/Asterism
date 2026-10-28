"""Tool registration, schema generation, and invocation for LLM function tools.

This module owns the process-wide ``tool_registry`` singleton. Tool modules
register functions with the ``@tool_registry.tool`` decorator at import time
(see ``builtin.load_builtin_tools``); the agent runtime invokes them through
:meth:`ToolRegistry.invoke_tool`, which validates model arguments, applies
policy gates, and normalizes outcomes into :class:`ToolResult` values.
"""

from __future__ import annotations

import inspect
import json
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Type, get_args

from openai.types.chat import (
    ChatCompletionFunctionToolParam,
)
from openai.types.shared_params import FunctionDefinition
from pydantic import BaseModel

from asterism.common.retries import async_retry
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.delegation_scope import DelegationScope
from asterism.domains.agent.execution_scope import ExecutionScope
from asterism.domains.agent.schemas import SubAgentEventEnvelope
from asterism.domains.chat.schemas import Chat
from asterism.domains.components.schemas import ComponentType
from asterism.domains.llm.schemas import LLMClientProtocol, ToolCall, ToolResult
from asterism.domains.settings.schemas import ApplicationSettings
from asterism.domains.tools.catalog import ToolPolicy, tool_policy
from asterism.domains.tools.context import ContextToolScope
from asterism.domains.tools.schemas import ToolInfo, ToolInfoList

if TYPE_CHECKING:
    from asterism.domains.files.runtime_access import RuntimeFileReader
    from asterism.domains.retrieval.service import RetrievalService


def _parse_tool_call_arguments(arguments: str | None) -> dict[str, Any] | None:
    """Parse a tool call's raw argument payload into a dict for validation.

    Args:
        arguments: The ``function.arguments`` payload from the model, usually a
            JSON string; some providers send dicts or quote-wrapped strings.

    Returns:
        The parsed object as a dict (an empty dict when no arguments were
        sent), or None when the payload is not a valid JSON object; callers
        should surface that as an explicit invalid-arguments error result.
    """
    if not arguments:
        return {}
    if isinstance(arguments, dict):
        return arguments

    text = arguments.strip()
    # Tolerate providers that wrap the whole JSON object in single quotes.
    if len(text) >= 2 and text.startswith("'") and text.endswith("'"):
        text = text[1:-1].strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _parse_result(
    tool_call: ToolCall,
    raw_result: Any,
) -> ToolResult:
    """Normalize an arbitrary tool return value into a persisted ToolResult.

    Args:
        tool_call: The originating model tool call this result answers.
        raw_result: Whatever the tool function returned (pydantic model, dict,
            list, scalar, string, or None).

    Returns:
        A ToolResult whose ``content`` is always JSON text for the LLM and
        whose ``is_empty`` flags results that carry no information. The original
        value is preserved in ``raw_result`` for persistence/audit.
    """
    is_empty = False
    if isinstance(raw_result, BaseModel):
        content = raw_result.model_dump_json()
        is_empty = content == "{}"
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
    """Frozen execution context handed to every tool function.

    Everything here is server-provided; a tool should treat ``args`` as the only
    model-controlled input and everything else as trusted runtime state.

    Attributes:
        args: Validated model arguments (the generic type parameter).
        user: Authenticated user owning this execution.
        user_message: The user message that started the current turn.
        session: Chat containing the conversation, including loaded messages.
        app_settings: Application settings snapshot for this invocation.
        client: LLM client bound to the chat's selected model.
        user_files: File names uploaded with the current user message.
        call_stack: Agent ids from the root agent down to the caller (used for
            sub-agent cycle/depth guards).
        caller_execution_id: Delegation execution id of the calling sub-agent;
            None when the main agent is the caller.
        event_sink: Optional sink streaming sub-agent events to the UI; may be
            sync or async.
        parent_message_id: Message id that triggered this tool call, if known.
        delegation_scope: Live sub-agent delegation selections for this chat.
        tool_scope: Server-derived context ceiling (see ContextToolScope); None
            outside scoped runs.
        execution_scope: Full execution scope snapshot, when the agent resolved one.
        retrieval_service: Injected retrieval service (search_knowledge).
        file_reader: Injected runtime file reader for project/chat files.
    """

    args: T
    user: AuthedUser
    user_message: str
    session: Chat
    app_settings: ApplicationSettings
    client: LLMClientProtocol
    user_files: list[str] = field(default_factory=list)
    call_stack: list[uuid.UUID] = field(default_factory=list)
    caller_execution_id: uuid.UUID | None = None
    event_sink: Callable[[SubAgentEventEnvelope], Awaitable[None] | None] | None = None
    parent_message_id: uuid.UUID | None = None
    delegation_scope: DelegationScope | None = None
    tool_scope: ContextToolScope | None = None
    execution_scope: ExecutionScope | None = None
    retrieval_service: RetrievalService | None = None
    file_reader: RuntimeFileReader | None = None


@dataclass(frozen=True)
class LLMTool[T: BaseModel]:
    """A registered tool: its model-facing schema plus the callable it maps to.

    Attributes:
        name: Tool name exposed to the model (and used in settings/allowlists).
        is_async: Whether the function is a coroutine (drives await handling).
        description: Model-facing description.
        schema: OpenAI function-tool parameter sent with chat completions.
        arg_validator: Pydantic model used to validate parsed arguments.
        function: The tool implementation, called with a ToolContext.
        component_type: Component backing this tool when it wraps one (e.g. a
            web search provider), used by admin UIs and capability pickers.
        policy: Authorization policy; derived from the name at registration.
    """

    name: str
    is_async: bool
    description: str
    schema: ChatCompletionFunctionToolParam
    arg_validator: Type[BaseModel]
    function: Callable[[ToolContext[T]], Any]
    component_type: ComponentType | None = None
    policy: ToolPolicy = ToolPolicy.USER_CONFIGURABLE


class ToolRegistry:
    """Holds registered tools and mediates their invocation.

    Registration is a side effect of importing tool modules; the registry also
    exposes model-facing schemas and user/admin tool listings.
    """

    def __init__(self) -> None:
        """Create an empty registry; tools are added via the ``tool`` decorator."""
        self.registry: dict[str, LLMTool] = {}

    def active_tools(self, app_settings: ApplicationSettings) -> ToolInfoList:
        """List user-configurable tools currently enabled by admin policy.

        Internal (context-managed) tools are excluded: their availability is
        derived per execution and never part of the configurable surface.

        Args:
            app_settings: Settings snapshot whose ``active_tools`` allowlist
                filters the listing.
        """
        return ToolInfoList(
            items=[
                ToolInfo(
                    name=t.name,
                    description=t.description,
                    component_type=t.component_type,
                    policy=t.policy,
                )
                for t in self.registry.values()
                if t.name in app_settings.active_tools and t.policy == ToolPolicy.USER_CONFIGURABLE
            ],
        )

    def tools(self) -> ToolInfoList:
        """List every registered tool regardless of policy or admin settings."""
        return ToolInfoList(
            items=[
                ToolInfo(
                    name=t.name,
                    description=t.description,
                    component_type=t.component_type,
                    policy=t.policy,
                )
                for t in self.registry.values()
            ],
        )

    def schemas(
        self,
        tool_names: list[str] | None = None,
    ) -> list[ChatCompletionFunctionToolParam]:
        """Model-facing function schemas for the given tool names.

        Args:
            tool_names: Names to include; None or an empty list yields no tools.

        Returns:
            OpenAI function-tool parameters in registration order.
        """
        if tool_names is None:
            return []

        tool_name_set = set(tool_names)
        return [llm_tool.schema for llm_tool in self.registry.values() if llm_tool.name in tool_name_set]

    def __getitem__(self, tool_name: str) -> LLMTool:
        return self.registry[tool_name]

    @staticmethod
    def _exception_to_tool_result(
        ex: BaseException,
        tool_call: ToolCall,
    ) -> ToolResult:
        """Convert a failed invocation into an error ToolResult the model can read.

        Args:
            ex: The exception that aborted the tool call.
            tool_call: The originating tool call, kept for correlation.
        """
        # Tool results are persisted in JSON columns. Never retain an exception
        # instance here: SQLAlchemy/Pydantic exceptions are not JSON serializable.
        error = f"Tool failed with exception: {ex}"
        return ToolResult(
            content=json.dumps({"error": error}),
            raw_result={"error": error},
            is_empty=True,
            tool_call=tool_call,
        )

    async def invoke_tool(
        self,
        tool_call: ToolCall,
        user: AuthedUser,
        client: LLMClientProtocol,
        session: Chat,
        app_settings: ApplicationSettings,
        user_message: str = "",
        user_files: list[str] | None = None,
        max_retries: int = 3,
        call_stack: list[uuid.UUID] | None = None,
        caller_execution_id: uuid.UUID | None = None,
        event_sink: Callable[[SubAgentEventEnvelope], Awaitable[None] | None] | None = None,
        parent_message_id: uuid.UUID | None = None,
        delegation_scope: DelegationScope | None = None,
        tool_scope: ContextToolScope | None = None,
        execution_scope: ExecutionScope | None = None,
        authorize_internal: Callable[[str], Awaitable[None]] | None = None,
        retrieval_service: RetrievalService | None = None,
        file_reader: RuntimeFileReader | None = None,
    ) -> ToolResult:
        """Validate, authorize, and run one model tool call.

        Pipeline: look up the tool, enforce the admin active-tool gate (the
        cheapest check, so disabled tools skip all further work), parse and
        validate arguments, reauthorize internal tools via
        ``authorize_internal``, build the ToolContext, then execute.
        Exceptions raised by the tool function itself are retried with backoff;
        validation and authorization failures are returned immediately without
        retry.

        Args:
            tool_call: The model's tool call to execute.
            user: Authenticated user running the execution.
            client: LLM client bound to the chat's selected model.
            session: Chat containing the conversation.
            app_settings: Settings snapshot for this invocation; its
                ``active_tools`` allowlist gates every tool.
            user_message: User message that started the turn (may be empty).
            user_files: File names uploaded with the user message.
            max_retries: Retries after the initial attempt for tool exceptions.
            call_stack: Agent ids from root to caller, for sub-agent guards.
            caller_execution_id: Delegation execution id of a calling
                sub-agent; None for the main agent.
            event_sink: Optional sink streaming sub-agent events to the UI.
            parent_message_id: Message id that triggered this call, if known.
            delegation_scope: Live sub-agent delegation selections.
            tool_scope: Server-derived context ceiling for internal tools.
            authorize_internal: Callback reauthorizing context-managed tools;
                must raise when the tool is unavailable in this context.
            retrieval_service: Injected retrieval service (search_knowledge).
            file_reader: Injected runtime file reader.

        Returns:
            A ToolResult; all failures are encoded as error content, never raised.
        """
        if user_files is None:
            user_files = []

        llm_tool = self.registry.get(tool_call.function.name)
        if llm_tool is None:
            return ToolRegistry._exception_to_tool_result(
                ValueError(f"Tool '{tool_call.function.name}' is not recognized or available"),
                tool_call,
            )

        # Cheapest gate first: a disabled tool skips argument parsing and the
        # internal-tool authorization round-trips entirely.
        if llm_tool.name not in app_settings.active_tools:
            return ToolRegistry._exception_to_tool_result(ValueError("Tool disabled by administrator"), tool_call)

        raw_arguments = _parse_tool_call_arguments(tool_call.function.arguments)
        if raw_arguments is None:
            preview = (tool_call.function.arguments or "").strip()[:200]
            return ToolRegistry._exception_to_tool_result(
                ValueError(f"Tool arguments must be a JSON object; got: {preview}"),
                tool_call,
            )

        # Only exceptions escaping call_tool are retried (i.e. raised by the
        # tool function itself); validation/authorization failures return a
        # ToolResult above and therefore never trigger a retry.
        @async_retry(
            max_retries=max_retries,
            on_exceed_attempts=lambda ex: ToolRegistry._exception_to_tool_result(ex, tool_call),
        )
        async def call_tool() -> ToolResult:

            try:
                arguments = llm_tool.arg_validator.model_validate(raw_arguments)
            except Exception as e:
                return ToolRegistry._exception_to_tool_result(e, tool_call)

            if llm_tool.policy == ToolPolicy.CONTEXT_MANAGED:
                # Generic gate for every context-managed tool. Internal builtins
                # (e.g. sub_agent) re-check authorization themselves because they
                # need the returned scope and must see live state; the duplicated
                # DB round-trips are deliberate defense in depth.
                try:
                    if authorize_internal is None or tool_scope is None:
                        raise ValueError("Internal tool unavailable without server authorization")
                    await authorize_internal(llm_tool.name)
                except Exception as error:
                    return ToolRegistry._exception_to_tool_result(error, tool_call)

            ctx = ToolContext(
                args=arguments,
                user=user,
                session=session,
                user_message=user_message,
                user_files=user_files,
                client=client,
                app_settings=app_settings,
                call_stack=list(call_stack) if call_stack else [],
                caller_execution_id=caller_execution_id,
                event_sink=event_sink,
                parent_message_id=parent_message_id,
                delegation_scope=delegation_scope,
                tool_scope=tool_scope,
                execution_scope=execution_scope,
                retrieval_service=retrieval_service,
                file_reader=file_reader,
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

    def tool[T: BaseModel](
        self,
        name: str | None = None,
        description: str | None = None,
        component_type: ComponentType | None = None,
    ) -> Callable[..., Callable[[ToolContext[T]], Any]]:
        """Decorator registering a function as an LLM tool.

        The decorated function must take exactly one parameter annotated
        ``ToolContext[Args]``; the Args model becomes both the runtime argument
        validator and the source of the JSON schema sent to the model.

        Args:
            name: Tool name for the model; defaults to the function name.
            description: Model-facing description; defaults to the docstring.
            component_type: Component backing this tool when it wraps one,
                used by admin UIs and capability pickers.
        """

        def to_json_schema(
            func: Callable[[ToolContext[T]], Any],
            func_name: str,
            func_description: str,
        ) -> tuple[Type[T], ChatCompletionFunctionToolParam]:
            """Derive the Args validator and OpenAI function schema from func's signature."""
            sig = inspect.signature(func)
            annotation = next(iter(sig.parameters.values())).annotation
            type_arguments = get_args(annotation)
            if not type_arguments:
                raise ValueError("Context is missing the generic Args type")
            args_class = type_arguments[0]
            param_schema = args_class.model_json_schema()
            param_schema["additionalProperties"] = False
            # Keep Pydantic's required list (only fields without defaults); ensure the
            # key exists so strict-mode providers always see an explicit array.
            param_schema.setdefault("required", [])
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
            func: Callable[[ToolContext[T]], Any],
        ) -> Callable[[ToolContext[T]], Any]:
            # Returned in place of func; currently an identity passthrough.
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
                policy=tool_policy(tool_name),
            )
            return wrapper

        return decorator


# Process-wide registry; tool modules register against it at import time.
# Callers needing the set of registered names read ``tool_registry.registry``.
tool_registry = ToolRegistry()
