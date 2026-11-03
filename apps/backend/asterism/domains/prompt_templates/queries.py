"""Owner-scoped base selects per template kind. Filtering occurs before pagination."""

from sqlalchemy import or_, select

from .models import PromptTemplateModel, TemplateKind


def _select_owned(user_id: str, kind: TemplateKind):
    return select(PromptTemplateModel).where(PromptTemplateModel.user_id == user_id, PromptTemplateModel.kind == kind)


def _search(statement, query: str):
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


def select_owned_templates(user_id: str):
    return _select_owned(user_id, TemplateKind.PROMPT)


def search_owned_templates(user_id: str, query: str):
    return _search(select_owned_templates(user_id), query)


def select_owned_rubrics(user_id: str):
    return _select_owned(user_id, TemplateKind.RUBRIC)


def search_owned_rubrics(user_id: str, query: str):
    return _search(select_owned_rubrics(user_id), query)
