"""Owner-scoped base selects. Filtering occurs before pagination."""

from sqlalchemy import or_, select

from .models import PromptTemplateModel


def select_owned_templates(user_id: str):
    return select(PromptTemplateModel).where(PromptTemplateModel.user_id == user_id)


def search_owned_templates(user_id: str, query: str):
    statement = select_owned_templates(user_id)
    if query:
        # Treat user search as literal text, not SQL wildcard syntax.
        pattern = "%" + query.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
        statement = statement.where(
            or_(
                PromptTemplateModel.name.ilike(pattern, escape="!"),
                PromptTemplateModel.description.ilike(pattern, escape="!"),
            )
        )
    return statement.order_by(PromptTemplateModel.updated_at.desc(), PromptTemplateModel.id)
