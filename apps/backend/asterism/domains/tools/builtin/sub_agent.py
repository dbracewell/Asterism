import inspect
import uuid

from pydantic import BaseModel, Field

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

    # 1. Cycle detection: check if target agent is already in the call stack
    if target_id in ctx.call_stack:
        chain = [str(aid) for aid in ctx.call_stack] + [str(target_id)]
        chain_str = " -> ".join(chain)
        return (
            f"Recursion cycle detected: Agent '{target_id}' is already "
            f"in the call chain ({chain_str}). Sub-agent call aborted."
        )

    # 2. Depth check: check if sub-agent depth exceeds maximum allowed
    # Each entry in call_stack represents an agent in the chain from root.
    # A chain length greater than max_sub_agent_depth exceeds the limit.
    if len(ctx.call_stack) > config.max_sub_agent_depth:
        chain_str = " -> ".join(str(aid) for aid in ctx.call_stack)
        return (
            f"Maximum sub-agent recursion depth of {config.max_sub_agent_depth} "  # noqa: E501
            f"exceeded (call chain: {chain_str}). Sub-agent call aborted. "
            f"Please decompose the task differently."
        )

    agent_profile = await get_agent_profile(ctx.user.id, target_id)
    if not agent_profile:
        raise ValueError(f"Agent with id {target_id} not found.")

    parent_tools = set(ctx.session.info.allowed_tools or [])
    sub_agent_profile_tools = set(agent_profile.tools or [])
    allowed_tools = sorted(parent_tools & sub_agent_profile_tools)

    sub_profile = agent_profile.model_copy(update={"tools": allowed_tools})

    child_call_stack = [*ctx.call_stack, target_id]

    agent = Agent(
        profile=sub_profile,
        user=ctx.user,
        session=ctx.session,
        allowed_tools=allowed_tools,
        approval_policy=AllowlistApprovalPolicy(),
        call_stack=child_call_stack,
        event_sink=ctx.event_sink,
        user_files=ctx.user_files,
    )

    forwarded_types = {
        AgentEventType.DELTA,
        AgentEventType.TOOL_CALL,
        AgentEventType.COMPLETE,
    }

    context_block = _build_parent_context_block(ctx)
    sub_agent_messages: list[LLMMessage] = []
    if context_block:
        sub_agent_messages.append(LLMMessage.system(context_block))
    sub_agent_messages.append(LLMMessage.user(ctx.args.prompt))

    last_response: AgentEvent = AgentEvent(type=AgentEventType.COMPLETE)
    async for event in agent.run(messages=sub_agent_messages):
        last_response = event
        if ctx.event_sink and event.type in forwarded_types:
            envelope = SubAgentEventEnvelope(
                sub_agent_id=target_id,
                sub_agent_name=agent_profile.name,
                depth=len(ctx.call_stack),
                event=event,
            )
            res = ctx.event_sink(envelope)
            if inspect.isawaitable(res):
                await res

    return (
        last_response.content
        if last_response.type == AgentEventType.COMPLETE
        else "Sub agent failed to complete the task."
    )
