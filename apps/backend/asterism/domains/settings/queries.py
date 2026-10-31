"""Owner-scoped base selects for providers and models.

Admin providers are global (``owner_user_id IS NULL``). A user's ChatGPT plan
provider is owned and must never appear in admin lists, admin-wide
selections (draft, captioning) or another user's pickers. Callers add their own
filters before execution.
"""

from sqlalchemy import ColumnElement, Select, or_, select
from sqlalchemy.orm import joinedload

from .models import LLMModel, ProviderModel


def select_visible_models(user_id: str) -> Select[tuple[LLMModel]]:
    """Models ``user_id`` may see: global models plus the user's own plan models."""
    return (
        select(LLMModel)
        .join(LLMModel.provider)
        .where(or_(ProviderModel.owner_user_id.is_(None), ProviderModel.owner_user_id == user_id))
        .options(joinedload(LLMModel.provider))
    )


def is_global_provider() -> ColumnElement[bool]:
    """Filter condition for admin-managed provider rows."""
    return ProviderModel.owner_user_id.is_(None)


def is_global_model() -> ColumnElement[bool]:
    """Filter condition for models of admin-managed providers (no join needed)."""
    return LLMModel.provider_id.in_(select(ProviderModel.id).where(is_global_provider()))
