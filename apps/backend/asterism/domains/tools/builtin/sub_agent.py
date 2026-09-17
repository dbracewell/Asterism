import uuid

from pydantic import BaseModel

from asterism.domains.agent.agent import Agent, AgentEvent, AgentEventType
from asterism.domains.llm.schemas import LLMMessage
from asterism.domains.tools.registry import ToolContext, tool_registry


class SubAgentArgs(BaseModel):
    agent_id: uuid.UUID
    prompt: str


@tool_registry.tool(
    description="Hands of work to a sub agent to perform.",
)
async def sub_agent(ctx: ToolContext[SubAgentArgs]) -> str:
    """
    Hands of work to a sub agent to perform.
    """
    from asterism.domains.agent.service import get_agent_profile

    agent_profile = await get_agent_profile(ctx.user.id, ctx.args.agent_id)
    if not agent_profile:
        raise ValueError(f"Agent with id {ctx.args.agent_id} not found.")

    agent = Agent(
        profile=agent_profile,
        user=ctx.user,
        allowed_tools=agent_profile.tools,
    )

    last_response: AgentEvent = AgentEvent(type=AgentEventType.COMPLETE)
    async for event in agent.run(messages=[LLMMessage.user(ctx.args.prompt)]):
        last_response = event

    return (
        last_response.content
        if last_response.type == AgentEventType.COMPLETE
        else "Sub agent failed to complete the task."
    )
