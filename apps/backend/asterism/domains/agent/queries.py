"""Owner-scoped selects for agent configuration storage."""

from sqlalchemy import select

from .models import AgentProfileModel


def select_owned_agent_profiles(user_id: str):
    return select(AgentProfileModel).where(AgentProfileModel.user_id == user_id)
