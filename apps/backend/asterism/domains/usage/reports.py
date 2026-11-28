"""Usage reads: the signed-in user's usage view and the admin report (ADR-0073)."""

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException

from .models import UsageRecordModel
from .queries import select_group_usage, select_usage_totals, select_user_usage
from .schemas import MyUsage, UsageGroupRow, UsageModelTotal, UsageReport, UsageUserRow
from .service import budget_windows, read_usage_settings, zone_for

MAX_REPORT_DAYS = 366
MAX_PAGE_SIZE = 100


def _cost(row) -> float | None:
    """A summed cost, or None when no call in it was priced (unknown rather than free)."""
    return round(float(row.cost), 6) if row.priced else None


def _model_total(row) -> UsageModelTotal:
    return UsageModelTotal(
        model_id=row.model_id,
        model_name=row.model_name,
        input_tokens=int(row.input_tokens or 0),
        output_tokens=int(row.output_tokens or 0),
        images=int(row.images or 0),
        cost_usd=_cost(row),
        unpriced_tokens=int(row.unpriced_tokens or 0),
    )


async def my_usage(user_id: str, session: AsyncSession, now: datetime | None = None) -> MyUsage:
    timezone, exempt, day, month = await budget_windows(user_id, session, now)
    rows = await session.execute(
        select_usage_totals(month.starts_at, month.resets_at).where(UsageRecordModel.user_id == user_id)
    )
    return MyUsage(
        timezone=timezone,
        exempt=exempt,
        day=day,
        month=month,
        month_by_model=[_model_total(row) for row in rows],
    )


def report_bounds(start: date, end: date, timezone: str) -> tuple[int, int]:
    """Local midnight at the start of ``start`` up to local midnight after ``end`` (both days included)."""
    if end < start:
        raise BadDataException("The end date is before the start date")
    if (end - start).days >= MAX_REPORT_DAYS:
        raise BadDataException(f"Choose a period of at most {MAX_REPORT_DAYS} days")
    zone = zone_for(timezone)
    following = end + timedelta(days=1)
    first = datetime(start.year, start.month, start.day, tzinfo=zone)
    last = datetime(following.year, following.month, following.day, tzinfo=zone)
    return int(first.timestamp()), int(last.timestamp())


async def _models_by_user(user_ids: list[str], begin: int, finish: int, session: AsyncSession):
    """Per-model totals for one page of users; the page bounds the id list."""
    by_user: dict[str, list[UsageModelTotal]] = defaultdict(list)
    if user_ids:
        rows = await session.execute(select_usage_totals(begin, finish).where(UsageRecordModel.user_id.in_(user_ids)))
        for row in rows:
            by_user[row.user_id].append(_model_total(row))
    return by_user


async def usage_report(
    session: AsyncSession,
    *,
    start: date | None = None,
    end: date | None = None,
    group_id: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> UsageReport:
    """Usage per group and in total, and one page of users with their models; defaults to this month so far.

    Totals and groups cover everyone in the period. ``group_id`` and ``search``
    narrow only the users, which are counted, filtered and paged in the database.
    """
    if page < 1 or not 1 <= page_size <= MAX_PAGE_SIZE:
        raise BadDataException("Invalid pagination")
    timezone = (await read_usage_settings(session)).timezone
    today = datetime.now(UTC).astimezone(zone_for(timezone)).date()
    begin, finish = report_bounds(start or today.replace(day=1), end or today, timezone)
    groups = list(await session.execute(select_group_usage(begin, finish)))
    people = select_user_usage(begin, finish, group_id=group_id, search=search)
    total_users = int(await session.scalar(select(func.count()).select_from(people.order_by(None).subquery())) or 0)
    page_rows = list(await session.execute(people.offset((page - 1) * page_size).limit(page_size)))
    models = await _models_by_user([row.user_id for row in page_rows], begin, finish, session)
    priced = [row for row in groups if row.priced]
    return UsageReport(
        timezone=timezone,
        start=begin,
        end=finish,
        users=[
            UsageUserRow(
                user_id=row.user_id,
                name=row.name or "",
                email=row.email or "",
                group_id=row.group_id,
                group_name=row.group_name,
                models=models[row.user_id],
                total_tokens=int(row.total_tokens or 0),
                cost_usd=_cost(row),
            )
            for row in page_rows
        ],
        total_users=total_users,
        page=page,
        page_size=page_size,
        groups=[
            UsageGroupRow(
                group_id=row.group_id,
                group_name=row.group_name,
                users=int(row.users),
                total_tokens=int(row.total_tokens or 0),
                images=int(row.images or 0),
                cost_usd=_cost(row),
            )
            for row in groups
        ],
        total_tokens=sum(int(row.total_tokens or 0) for row in groups),
        cost_usd=round(sum(float(row.cost) for row in priced), 6) if priced else None,
    )
