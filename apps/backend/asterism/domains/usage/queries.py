"""Ledger aggregation: tokens, images and estimated cost per user, model and group over a period."""

from sqlalchemy import Select, case, func, or_, select

from asterism.domains.groups.models import GroupModel
from asterism.domains.user.models import UserModel

from .models import UsageRecordModel as Usage

_priced = Usage.input_price_per_million.is_not(None)
TOKENS = Usage.input_tokens + Usage.output_tokens
_COST = func.sum(
    case(
        (
            _priced,
            (Usage.input_tokens * Usage.input_price_per_million + Usage.output_tokens * Usage.output_price_per_million)
            / 1_000_000.0,
        ),
        else_=0.0,
    )
).label("cost")
_PRICED = func.sum(case((_priced, 1), else_=0)).label("priced")


def _in_period(statement: Select, start: int, end: int) -> Select:
    return statement.where(Usage.created_at >= start, Usage.created_at < end)


def select_usage_totals(start: int, end: int) -> Select:
    """One row per (user, model) with usage in ``[start, end)``, ordered for display.

    ``cost`` sums only priced rows; ``priced`` counts them, so a total with no
    priced row reads as unknown rather than free.
    """
    statement = select(
        Usage.user_id,
        Usage.model_id,
        Usage.model_name,
        func.sum(Usage.input_tokens).label("input_tokens"),
        func.sum(Usage.output_tokens).label("output_tokens"),
        func.sum(Usage.images).label("images"),
        _COST,
        _PRICED,
        func.sum(case((_priced, 0), else_=TOKENS)).label("unpriced_tokens"),
    )
    return (
        _in_period(statement, start, end)
        .group_by(Usage.user_id, Usage.model_id, Usage.model_name)
        .order_by(Usage.user_id, Usage.model_name, Usage.model_id)
    )


def select_user_usage(start: int, end: int, *, group_id: str | None = None, search: str | None = None) -> Select:
    """One row per user with usage in ``[start, end)``: name, group and totals.

    Optionally only one group's members, or users whose name, email or id
    contains ``search``. Ordered by most tokens, then name ignoring case, then
    id, so pages are stable.
    """
    total = func.sum(TOKENS).label("total_tokens")
    statement = (
        select(
            Usage.user_id,
            UserModel.name,
            UserModel.email,
            UserModel.group_id,
            GroupModel.name.label("group_name"),
            total,
            _COST,
            _PRICED,
        )
        .join(UserModel, UserModel.id == Usage.user_id)
        .outerjoin(GroupModel, GroupModel.id == UserModel.group_id)
    )
    statement = _in_period(statement, start, end)
    if group_id is not None:
        statement = statement.where(UserModel.group_id == group_id)
    if search and (term := search.strip()):
        statement = statement.where(
            or_(
                UserModel.name.icontains(term, autoescape=True),
                UserModel.email.icontains(term, autoescape=True),
                UserModel.id.icontains(term, autoescape=True),
            )
        )
    return statement.group_by(
        Usage.user_id, UserModel.name, UserModel.email, UserModel.group_id, GroupModel.name
    ).order_by(total.desc(), func.lower(func.coalesce(UserModel.name, "")), Usage.user_id)


def select_group_usage(start: int, end: int) -> Select:
    """One row per group with usage in ``[start, end)``: users, tokens, images and cost."""
    total = func.sum(TOKENS).label("total_tokens")
    statement = (
        select(
            UserModel.group_id,
            GroupModel.name.label("group_name"),
            func.count(func.distinct(Usage.user_id)).label("users"),
            total,
            func.sum(Usage.images).label("images"),
            _COST,
            _PRICED,
        )
        .join(UserModel, UserModel.id == Usage.user_id)
        .outerjoin(GroupModel, GroupModel.id == UserModel.group_id)
    )
    return (
        _in_period(statement, start, end)
        .group_by(UserModel.group_id, GroupModel.name)
        .order_by(total.desc(), func.lower(func.coalesce(GroupModel.name, "")), UserModel.group_id)
    )
