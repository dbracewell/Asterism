import inspect
import time
import uuid

from pydantic import BaseModel, Field

from asterism.common.log import get_logger
from asterism.domains.agent.agent import Agent, AgentEvent, AgentEventType
from asterism.domains.agent.schemas import SubAgentEventEnvelope
from asterism.domains.llm.schemas import LLMMessage
from asterism.domains.tools.registry import ToolContext, tool_registry


class SubAgentArgs(BaseModel):
    agent_id: uuid.UUID
    prompt: str
    parent_context: str | None = Field(
        default=None,
        description=(
            "Optional additional context or instructions from the caller "
            "to forward to the sub-agent."
        ),
    )


def _build_parent_context_block(ctx: ToolContext[SubAgentArgs]) -> str | None:
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
    if ctx.session and getattr(ctx.session, "messages", None):
        max_messages = getattr(config, "sub_agent_context_window_messages", 10)
        max_tokens = getattr(config, "sub_agent_context_window_tokens", 4000)

        selected_messages = []
        accumulated_tokens = 0

        for msg in reversed(ctx.session.messages):
            if len(selected_messages) >= max_messages:
                break

            msg_content = msg.content or ""
            msg_tokens = getattr(msg, "token_count", 0) or max(
                1, len(msg_content) // 4
            )
            if (
                accumulated_tokens + msg_tokens > max_tokens
                and selected_messages
            ):
                break

            role = getattr(msg, "role", "user").capitalize()
            selected_messages.append(f"[{role}]: {msg_content}")
            accumulated_tokens += msg_tokens

        if selected_messages:
            selected_messages.reverse()
            convo_str = "\n".join(selected_messages)
            sections.append(f"### Recent Conversation History\n{convo_str}")

    if not sections:
        return None

    body = "\n\n".join(sections)
    return (
        "--- FORWARDED PARENT CONTEXT ---\n"
        "The following context has been forwarded from the parent conversation "
        "to assist with your delegated task:\n\n"
        f"{body}\n"
        "--- END FORWARDED PARENT CONTEXT ---"
    )


@tool_registry.tool(
    description="Hands of work to a sub agent to perform.",
)
async def sub_agent(ctx: ToolContext[SubAgentArgs]) -> str:
    """
    Hands of work to a sub agent to perform.
    """
    from asterism.core.config import config
    from asterism.domains.agent.approval import AllowlistApprovalPolicy
    from asterism.domains.agent.service import get_agent_profile

    target_id = ctx.args.agent_id
    execution_id = uuid.uuid4()
    logger = get_logger("SUB_AGENT")
    logger.info(
        "delegation requested execution_id=%s target_agent_id=%s "
        "parent_message_id=%s chat_id=%s depth=%d",
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
            "delegation rejected execution_id=%s reason=depth_limit "
            "max_depth=%d chain=%s",
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
        agent_profile = await get_agent_profile(ctx.user.id, target_id)
    except Exception:
        logger.exception(
            "delegation profile lookup failed execution_id=%s "
            "target_agent_id=%s",
            execution_id,
            target_id,
        )
        error = AgentEvent(
            type=AgentEventType.ERROR,
            content=(
                "Sub-agent could not be loaded. Check backend logs with "
                f"execution ID {execution_id}."
            ),
        )
        if ctx.event_sink:
            res = ctx.event_sink(
                SubAgentEventEnvelope(
                    execution_id=execution_id,
                    sub_agent_id=target_id,
                    sub_agent_name="Unknown sub-agent",
                    depth=len(ctx.call_stack),
                    event=error,
                )
            )
            if inspect.isawaitable(res):
                await res
        return error.content

    if not agent_profile:
        logger.warning(
            "delegation rejected execution_id=%s reason=profile_not_found "
            "target_agent_id=%s",
            execution_id,
            target_id,
        )
        content = f"Agent with id {target_id} was not found."
        if ctx.event_sink:
            res = ctx.event_sink(
                SubAgentEventEnvelope(
                    execution_id=execution_id,
                    sub_agent_id=target_id,
                    sub_agent_name="Unknown sub-agent",
                    depth=len(ctx.call_stack),
                    event=AgentEvent(
                        type=AgentEventType.ERROR,
                        content=content,
                    ),
                )
            )
            if inspect.isawaitable(res):
                await res
        return content

    # Authorization to invoke `sub_agent` belongs to the parent. Once
    # delegated, the child runs autonomously with the active tools explicitly
    # assigned to its own profile; requiring the parent to duplicate those
    # assignments would make specialized sub-agents ineffective.
    allowed_tools = sorted(set(agent_profile.tools or []))
    logger.debug(
        "delegation authorized execution_id=%s sub_agent_name=%s "
        "approval_mode=profile_allowlist allowed_tools=%s",
        execution_id,
        agent_profile.name,
        allowed_tools,
    )

    sub_profile = agent_profile.model_copy(update={"tools": allowed_tools})

    child_call_stack = [*ctx.call_stack, target_id]

    parent_msg_id = ctx.parent_message_id
    if (
        parent_msg_id is None
        and ctx.session
        and getattr(ctx.session, "messages", None)
    ):
        parent_msg_id = ctx.session.messages[-1].id

    agent = Agent(
        profile=sub_profile,
        user=ctx.user,
        session=ctx.session,
        allowed_tools=allowed_tools,
        approval_policy=AllowlistApprovalPolicy(),
        call_stack=child_call_stack,
        event_sink=ctx.event_sink,
        user_files=ctx.user_files,
        parent_message_id=parent_msg_id,
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
        sub_agent_messages.append(LLMMessage.system(context_block))
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
        "delegation started execution_id=%s sub_agent_name=%s "
        "context_included=%s file_count=%d",
        execution_id,
        agent_profile.name,
        context_block is not None,
        len(ctx.user_files),
    )
    try:
        async for event in agent.run(messages=sub_agent_messages):
            received_event = True
            last_response = event
            if event.type == AgentEventType.COMPLETE:
                step_count += 1
                total_tokens += event.total_tokens or 0

            if ctx.event_sink and event.type in forwarded_types:
                envelope = SubAgentEventEnvelope(
                    execution_id=execution_id,
                    sub_agent_id=target_id,
                    sub_agent_name=agent_profile.name,
                    depth=len(ctx.call_stack),
                    event=event,
                )
                res = ctx.event_sink(envelope)
                if inspect.isawaitable(res):
                    await res
        if not received_event and ctx.event_sink:
            res = ctx.event_sink(
                SubAgentEventEnvelope(
                    execution_id=execution_id,
                    sub_agent_id=target_id,
                    sub_agent_name=agent_profile.name,
                    depth=len(ctx.call_stack),
                    event=last_response,
                )
            )
            if inspect.isawaitable(res):
                await res
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
        if ctx.event_sink:
            res = ctx.event_sink(
                SubAgentEventEnvelope(
                    execution_id=execution_id,
                    sub_agent_id=target_id,
                    sub_agent_name=agent_profile.name,
                    depth=len(ctx.call_stack),
                    event=last_response,
                )
            )
            if inspect.isawaitable(res):
                await res

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

        serialized_messages = [
            m.model_dump(mode="json")
            for m in getattr(agent, "messages", sub_agent_messages)
        ]
        trace_data = SubAgentTraceCreate(
            user_id=ctx.user.id,
            parent_message_id=parent_msg_id,
            sub_agent_id=target_id,
            sub_agent_name=agent_profile.name,
            prompt=ctx.args.prompt,
            caller_context=ctx.args.parent_context,
            messages=serialized_messages,
            result=(
                last_response.content
                if last_response.type == AgentEventType.COMPLETE
                else None
            ),
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
            "delegation trace persistence failed execution_id=%s "
            "parent_message_id=%s",
            execution_id,
            parent_msg_id,
            exc_info=True,
        )

    if last_response.type == AgentEventType.COMPLETE:
        return last_response.content
    if last_response.type == AgentEventType.ERROR and last_response.content:
        return last_response.content
    return "Sub-agent failed to complete the task."
