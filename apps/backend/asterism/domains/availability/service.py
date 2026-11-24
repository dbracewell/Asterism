"""Assemble one person's availability from each domain's own policy checks."""

from sqlalchemy.ext.asyncio import AsyncSession

from .schemas import Availability, FeatureAvailability


def _switch(enabled: bool, reason: str) -> FeatureAvailability:
    return FeatureAvailability(available=True) if enabled else FeatureAvailability(available=False, reason=reason)


async def read_availability(user_id: str, session: AsyncSession) -> Availability:
    from asterism.domains.canvas import policy as canvas_policy
    from asterism.domains.chatgpt import policy as chatgpt_policy
    from asterism.domains.image_generation import policy as image_policy
    from asterism.domains.memory.access import memory_allowed
    from asterism.domains.settings.tool_settings import get_tool_settings
    from asterism.domains.skills import policy as skills_policy

    memory = await memory_allowed(user_id, session)
    images = await image_policy.availability(user_id, session)
    return Availability(
        memory=FeatureAvailability(available=memory.available, reason=memory.reason),
        canvas=_switch((await canvas_policy.read_policy(session)).enabled, "Your administrator has turned canvas off"),
        image_generation=FeatureAvailability(available=images.available, reason=images.reason),
        skills=_switch((await skills_policy.read_policy(session)).enabled, "Your administrator has turned skills off"),
        chatgpt_plans=_switch(
            (await chatgpt_policy.read_policy(session)).enabled,
            "Your administrator has turned ChatGPT plan connections off",
        ),
        delegation=_switch(
            "sub_agent" in (await get_tool_settings(session)).active_tools,
            "Your administrator has turned sub-agents off",
        ),
    )
