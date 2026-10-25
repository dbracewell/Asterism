"""Owner-scoped base selects. Filtering occurs before pagination."""

from sqlalchemy import or_, select

from .models import AgentSkillModel, SkillModel


def select_owned_skills(user_id: str):
    return select(SkillModel).where(SkillModel.user_id == user_id)


def search_owned_skills(user_id: str, query: str):
    statement = select_owned_skills(user_id)
    if query:
        # Treat user search as literal text, not SQL wildcard syntax.
        pattern = "%" + query.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
        statement = statement.where(
            or_(SkillModel.name.ilike(pattern, escape="!"), SkillModel.description.ilike(pattern, escape="!"))
        )
    return statement.order_by(SkillModel.updated_at.desc(), SkillModel.id)


def select_owned_assignments(user_id: str):
    return select(AgentSkillModel).where(AgentSkillModel.user_id == user_id)
