"""User query composition: the owner-neutral admin user list and admin counts."""

from sqlalchemy import func, or_, select

from asterism.domains.groups.models import ADMIN_GROUP

from .models import UserModel


def select_active_admin_count(*, excluding: str | None = None):
    """How many administrators are not suspended, optionally not counting one account."""
    statement = (
        select(func.count())
        .select_from(UserModel)
        .where(UserModel.group_id == ADMIN_GROUP, UserModel.suspended_at.is_(None))
    )
    return statement if excluding is None else statement.where(UserModel.id != excluding)


def select_users(*, search: str | None = None):
    """Every user, for administrators, optionally matching ``search`` in name, email or id.

    Ordered by name ignoring case (unnamed last), then id, so pages are stable.
    """
    statement = select(UserModel)
    if search and (term := search.strip()):
        statement = statement.where(
            or_(
                UserModel.name.icontains(term, autoescape=True),
                UserModel.email.icontains(term, autoescape=True),
                UserModel.id.icontains(term, autoescape=True),
            )
        )
    return statement.order_by(UserModel.name.is_(None), func.lower(UserModel.name), UserModel.name, UserModel.id)
