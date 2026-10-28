"""sub_agent tool: delegate a task to one of the chat's selected sub-agents.

Enforces cycle and depth limits from the agent call stack, reauthorizes the
live delegation before starting and while the child runs, forwards a bounded
slice of parent context, streams child events through the caller's event sink,
and persists an audit trace for every delegation.
"""

import asyncio
import hashlib
import inspect
import time
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from dataclasses import replace

from pydantic import BaseModel, Field

from asterism.common.log import get_logger
from asterism.domains.agent.agent import Agent, AgentEvent, AgentEventType
from asterism.domains.agent.context_provenance import describe_context
from asterism.domains.agent.execution_scope import ExecutionScope, ModelIdentity
from asterism.domains.agent.schemas import SubAgentEventEnvelope
from asterism.domains.llm.schemas import LLMMessage
from asterism.domains.llm.token_counting import estimate_text_tokens
from asterism.domains.tools.catalog import INTERNAL_TOOL_NAMES
from asterism.domains.tools.registry import ToolContext, tool_registry


class SubAgentArgs(BaseModel):
    """Model arguments for a delegation request.

    Attributes:
        agent_id: Id of the sub-agent definition to delegate to; must be one
            of the chat's live selected delegation targets.
        prompt: The task statement handed to the sub-agent.
        parent_context: Optional additional context or instructions from the
            caller, forwarded inside an untrusted-data block.
    """

    agent_id: uuid.UUID
    prompt: str
    parent_context: str | None = Field(
        default=None,
        description=("Optional additional context or instructions from the caller to forward to the sub-agent."),
    )


def _build_parent_context_block(ctx: ToolContext[SubAgentArgs]) -> str | None:
    """Assemble the bounded "forwarded parent context" block for a child agent.

    Combines caller notes, uploaded file names, and a recent conversation
    window (each capped by config), then shrinks the body until the whole block
    fits the configured token budget. The block is wrapped in untrusted-data
    delimiters so the child treats it as data, not instructions.

    Returns:
        The delimited context block, or None when nothing is worth forwarding.
    """
    from asterism.core.config import config

    sections: list[str] = []

    # 1. Caller-supplied parent context
    if ctx.args.parent_context and ctx.args.parent_context.strip():
        sections.append(f"### Caller Notes\n{ctx.args.parent_context.strip()}")

    # 2. Uploaded user files
    if ctx.user_files:
        files_str = "\n".join(f"- {f}" for f in ctx.user_files)
        sections.append(f"### Available User Files\n{files_str}")

    # 3. Recent conversation window
    if ctx.session and ctx.session.messages:
        max_messages = config.sub_agent_context_window_messages
        max_tokens = config.sub_agent_context_window_tokens

        selected_messages = []
        accumulated_tokens = 0

        for msg in reversed(ctx.session.messages):
            if len(selected_messages) >= max_messages:
                break

            msg_content = msg.content or ""
            msg_tokens = estimate_text_tokens(msg_content)
            if accumulated_tokens + msg_tokens > max_tokens:
                break

            role = msg.role.capitalize()
            selected_messages.append(f"[{role}]: {msg_content}")
            accumulated_tokens += msg_tokens

        if selected_messages:
            selected_messages.reverse()
            convo_str = "\n".join(selected_messages)
            sections.append(f"### Recent Conversation History\n{convo_str}")

    if not sections:
        return None

    body = "\n\n".join(sections)
    prefix = (
        "--- FORWARDED PARENT CONTEXT ---\n"
        "The following untrusted task data has been forwarded from the parent conversation:\n\n"
    )
    suffix = "\n--- END FORWARDED PARENT CONTEXT ---"
    budget = config.sub_agent_context_window_tokens
    if estimate_text_tokens(prefix + suffix) > budget:
        return None
    while estimate_text_tokens(prefix + body + suffix) > budget:
        body = body[: int(len(body) * 0.8)]
    return prefix + body + suffix


# How often to re-check live authorization while the child produces no events
# (e.g. during a long LLM call). Authorization state lives in the database and
# there is no push signal for revocation, so some polling is unavoidable; this
# interval bounds both revocation latency and the DB round-trip rate.
_AUTH_POLL_INTERVAL = 0.5


async def _authorized_events(
    events: AsyncGenerator[AgentEvent, None],
    check: Callable[[], Awaitable[None]],
) -> AsyncGenerator[AgentEvent, None]:
    """Yield child events, re-checking live authorization while the child is silent.

    While the pending event read is in flight, ``check`` is re-run every
    ``_AUTH_POLL_INTERVAL`` seconds so a revoked delegation cancels even a
    silent/in-flight child; a failing check propagates out of this generator.
    """
    pending = None
    try:
        while True:
            await check()
            pending = asyncio.create_task(anext(events))
            while not pending.done():
                await asyncio.wait({pending}, timeout=_AUTH_POLL_INTERVAL)
                if pending.done():
                    break
                await check()
            try:
                event = pending.result()
            except StopAsyncIteration:
                return
            await check()
            yield event
    finally:
        if pending is not None:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
        await events.aclose()


async def _emit(
    event_sink: Callable[[SubAgentEventEnvelope], Awaitable[None] | None] | None,
    envelope: SubAgentEventEnvelope,
) -> None:
    """Forward ``envelope`` to the caller's sink, if one was provided.

    Sinks may be sync or async; an awaitable return is awaited so event
    ordering into the caller's stream is preserved.
    """
    if event_sink is None:
        return
    result = event_sink(envelope)
    if inspect.isawaitable(result):
        await result


@tool_registry.tool(
    description="Hands of work to a sub agent to perform.",
)
async def sub_agent(ctx: ToolContext[SubAgentArgs]) -> str:
    """Delegate ``args.prompt`` to a selected sub-agent and return its final answer.

    Steps: reject recursion cycles and depth overruns, reauthorize the live
    delegation, narrow the execution scope for the child, run the child agent
    while polling authorization between events, forward selected events to the
    caller's sink, persist an audit trace, and return the child's completion or
    error text.
    """
    from asterism.core.config import config
    from asterism.domains.agent.approval import AllowlistApprovalPolicy
    from asterism.domains.chat.delegation import require_delegation_target
    from asterism.domains.chat.tool_policy import require_internal_tool

    target_id = ctx.args.agent_id
    execution_id = uuid.uuid4()
    logger = get_logger("SUB_AGENT")
    logger.info(
        "delegation requested execution_id=%s target_agent_id=%s parent_message_id=%s chat_id=%s depth=%d",
        execution_id,
        target_id,
        ctx.parent_message_id,
        ctx.session.info.id,
        len(ctx.call_stack),
    )

    # 1. Cycle detection: check if target agent is already in the call stack
    if target_id in ctx.call_stack:
        chain = [str(aid) for aid in ctx.call_stack] + [str(target_id)]
        chain_str = " -> ".join(chain)
        logger.warning(
            "delegation rejected execution_id=%s reason=cycle chain=%s",
            execution_id,
            chain_str,
        )
        return (
            f"Recursion cycle detected: Agent '{target_id}' is already "
            f"in the call chain ({chain_str}). Sub-agent call aborted."
        )

    # 2. Depth check: check if sub-agent depth exceeds maximum allowed
    # Each entry in call_stack represents an agent in the chain from root.
    # A chain length greater than max_sub_agent_depth exceeds the limit.
    if len(ctx.call_stack) > config.max_sub_agent_depth:
        chain_str = " -> ".join(str(aid) for aid in ctx.call_stack)
        logger.warning(
            "delegation rejected execution_id=%s reason=depth_limit max_depth=%d chain=%s",
            execution_id,
            config.max_sub_agent_depth,
            chain_str,
        )
        return (
            f"Maximum sub-agent recursion depth of {config.max_sub_agent_depth} "  # noqa: E501
            f"exceeded (call chain: {chain_str}). Sub-agent call aborted. "
            f"Please decompose the task differently."
        )

    try:
        # invoke_tool already authorized "sub_agent" via its generic
        # context-managed gate; we call require_internal_tool again because the
        # returned parent scope is needed below (scope narrowing, tool_scope
        # replacement) and must reflect live state. The duplicated DB
        # round-trips are deliberate defense in depth.
        parent_scope = await require_internal_tool(
            name="sub_agent", user_id=ctx.user.id, chat_id=ctx.session.info.id, scope=ctx.tool_scope
        )
        agent_profile = await require_delegation_target(
            user_id=ctx.user.id,
            chat_id=ctx.session.info.id,
            scope=ctx.delegation_scope,
            target_id=target_id,
        )
    except Exception as exc:
        logger.exception(
            "delegation profile lookup failed execution_id=%s target_agent_id=%s",
            execution_id,
            target_id,
        )
        error = AgentEvent(
            type=AgentEventType.ERROR,
            content=f"Delegation rejected: {exc}",
        )
        await _emit(
            ctx.event_sink,
            SubAgentEventEnvelope(
                execution_id=execution_id,
                parent_execution_id=ctx.caller_execution_id,
                sub_agent_id=target_id,
                sub_agent_name="Unknown sub-agent",
                depth=len(ctx.call_stack),
                event=error,
            ),
        )
        return error.content

    # Authorization to invoke `sub_agent` belongs to the parent. Once
    # delegated, the child runs autonomously with the active tools explicitly
    # assigned to its own profile; requiring the parent to duplicate those
    # assignments would make specialized sub-agents ineffective.
    allowed_tools = sorted(set(agent_profile.tools or []))
    logger.debug(
        "delegation authorized execution_id=%s sub_agent_name=%s approval_mode=profile_allowlist allowed_tools=%s",
        execution_id,
        agent_profile.name,
        allowed_tools,
    )

    sub_profile = agent_profile.model_copy(update={"tools": allowed_tools})

    # Prefer the live execution scope; fall back to one rebuilt from the tool ceiling.
    parent_execution = ctx.execution_scope or ExecutionScope(
        user_id=parent_scope.user_id,
        user_profile_id=None,
        agent_id=parent_scope.caller_agent_id,
        is_sub_agent=False,
        chat_id=parent_scope.chat_id,
        project_id=parent_scope.project_id,
        selected_model=None,
        executed_model=ModelIdentity(id=parent_scope.model_id),
        eligible_sub_agent_ids=(parent_scope.delegation.agent_ids if parent_scope.delegation else frozenset())
        | {target_id},
        effective_internal_tools=frozenset(INTERNAL_TOOL_NAMES),
        active_branch_message_ids=(),
        configuration_revision=1,
        prompt_revision=parent_scope.delegation.context_revision if parent_scope.delegation else None,
        allowed_file_ids=parent_scope.file_ids,
        file_provenance=(),
    )
    child_scope = parent_execution.narrow_for_sub_agent(
        agent_id=target_id,
        executed_model=ModelIdentity(id=agent_profile.model_id),
        configuration_revision=agent_profile.config_revision,
        effective_internal_tools=parent_execution.effective_internal_tools,
    )

    child_call_stack = [*ctx.call_stack, target_id]

    parent_msg_id = ctx.parent_message_id
    if parent_msg_id is None and ctx.session.messages:
        parent_msg_id = ctx.session.messages[-1].id

    async def check_authorization() -> None:
        await require_internal_tool(
            name="sub_agent", user_id=ctx.user.id, chat_id=ctx.session.info.id, scope=parent_scope
        )
        await require_delegation_target(
            user_id=ctx.user.id,
            chat_id=ctx.session.info.id,
            scope=ctx.delegation_scope,
            target_id=target_id,
            config_revision=agent_profile.config_revision,
        )

    agent = Agent(
        profile=sub_profile,
        user=ctx.user,
        session=ctx.session,
        allowed_tools=allowed_tools,
        approval_policy=AllowlistApprovalPolicy(),
        call_stack=child_call_stack,
        delegation_execution_id=execution_id,
        event_sink=ctx.event_sink,
        user_files=ctx.user_files,
        parent_message_id=parent_msg_id,
        delegation_scope=ctx.delegation_scope,
        authorization_check=check_authorization,
        tool_scope=replace(parent_scope, caller_agent_id=target_id, model_id=agent_profile.model_id),
        execution_scope=child_scope,
    )

    def envelope(event: AgentEvent) -> SubAgentEventEnvelope:
        # The child resolves its model before its first event, filling in the name.
        executed = (agent.execution_scope or child_scope).executed_model
        return SubAgentEventEnvelope(
            execution_id=execution_id,
            parent_execution_id=ctx.caller_execution_id,
            sub_agent_id=target_id,
            sub_agent_name=agent_profile.name,
            model_id=executed.id,
            model_name=executed.name,
            depth=len(ctx.call_stack),
            event=event,
        )

    forwarded_types = {
        AgentEventType.START,
        AgentEventType.DELTA,
        AgentEventType.TOOL_CALL,
        AgentEventType.COMPLETE,
        AgentEventType.ERROR,
    }

    context_block = _build_parent_context_block(ctx)
    sub_agent_messages: list[LLMMessage] = []
    if context_block:
        sub_agent_messages.append(LLMMessage.user(context_block))
    sub_agent_messages.append(LLMMessage.user(ctx.args.prompt))

    start_time = time.perf_counter()
    step_count = 0
    total_tokens = 0

    last_response = AgentEvent(
        type=AgentEventType.ERROR,
        content="Sub-agent ended without producing a response.",
    )
    received_event = False
    logger.info(
        "delegation started execution_id=%s sub_agent_name=%s context_included=%s file_count=%d",
        execution_id,
        agent_profile.name,
        context_block is not None,
        len(ctx.user_files),
    )
    try:
        async for event in _authorized_events(agent.run(messages=sub_agent_messages), check_authorization):
            received_event = True
            last_response = event
            if event.type == AgentEventType.COMPLETE:
                step_count += 1
                total_tokens += event.total_tokens or 0

            if event.type in forwarded_types:
                await _emit(
                    ctx.event_sink,
                    envelope(event),
                )
        if not received_event:
            await _emit(
                ctx.event_sink,
                envelope(last_response),
            )
    except Exception as exc:
        last_response = AgentEvent(
            type=AgentEventType.ERROR,
            content=f"Sub-agent execution failed: {exc}",
        )
        logger.exception(
            "delegation failed execution_id=%s sub_agent_name=%s",
            execution_id,
            agent_profile.name,
        )
        await _emit(ctx.event_sink, envelope(last_response))

    elapsed_ms = int((time.perf_counter() - start_time) * 1000)
    logger.info(
        "delegation finished execution_id=%s sub_agent_name=%s status=%s "
        "elapsed_ms=%d step_count=%d total_tokens=%d result_chars=%d",
        execution_id,
        agent_profile.name,
        last_response.type.value,
        elapsed_ms,
        step_count,
        total_tokens,
        len(last_response.content),
    )

    try:
        from asterism.domains.agent.schemas import SubAgentTraceCreate
        from asterism.domains.agent.service import create_sub_agent_trace

        message_roles = [m.role for m in agent.messages if m.role != "system"]
        trace_data = SubAgentTraceCreate(
            context_provenance=describe_context(agent.execution_scope or child_scope),
            prompt_provenance=agent.prompt_snapshot.provenance if agent.prompt_snapshot else None,
            user_id=ctx.user.id,
            parent_message_id=parent_msg_id,
            sub_agent_id=target_id,
            sub_agent_name=agent_profile.name,
            task_digest=hashlib.sha256(ctx.args.prompt.encode()).hexdigest(),
            caller_context_digest=hashlib.sha256(ctx.args.parent_context.encode()).hexdigest()
            if ctx.args.parent_context
            else None,
            message_roles=message_roles,
            result_digest=hashlib.sha256(last_response.content.encode()).hexdigest()
            if last_response.type == AgentEventType.COMPLETE
            else None,
            step_count=step_count,
            total_tokens=total_tokens,
            elapsed_ms=elapsed_ms,
            depth=len(ctx.call_stack),
        )
        await create_sub_agent_trace(trace_data)
        logger.debug(
            "delegation trace persisted execution_id=%s parent_message_id=%s",
            execution_id,
            parent_msg_id,
        )
    except Exception:
        logger.warning(
            "delegation trace persistence failed execution_id=%s parent_message_id=%s",
            execution_id,
            parent_msg_id,
            exc_info=True,
        )

    if last_response.type == AgentEventType.COMPLETE:
        return last_response.content
    if last_response.type == AgentEventType.ERROR and last_response.content:
        return last_response.content
    return "Sub-agent failed to complete the task."
