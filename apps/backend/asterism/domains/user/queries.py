"""User query composition: the owner-neutral admin user list."""

from sqlalchemy import func, or_, select

from .models import UserModel


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
