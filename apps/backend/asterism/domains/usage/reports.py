"""Usage reads: the signed-in user's usage view and the admin report (ADR-0073)."""

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException
from asterism.domains.groups.models import GroupModel
from asterism.domains.user.models import UserModel

from .models import UsageRecordModel
from .queries import select_usage_totals
from .schemas import MyUsage, UsageGroupRow, UsageModelTotal, UsageReport, UsageUserRow
from .service import budget_windows, read_usage_settings, zone_for

MAX_REPORT_DAYS = 366


def _model_total(row) -> UsageModelTotal:
    return UsageModelTotal(
        model_id=row.model_id,
        model_name=row.model_name,
        input_tokens=int(row.input_tokens or 0),
        output_tokens=int(row.output_tokens or 0),
        images=int(row.images or 0),
        cost_usd=round(float(row.cost), 6) if row.priced else None,
        unpriced_tokens=int(row.unpriced_tokens or 0),
    )


def _sum_cost(costs: list[float | None]) -> float | None:
    known = [cost for cost in costs if cost is not None]
    return round(sum(known), 6) if known else None


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


async def usage_report(start: date | None, end: date | None, session: AsyncSession) -> UsageReport:
    """Usage per user and model and per group; defaults to the current month so far."""
    timezone = (await read_usage_settings(session)).timezone
    today = datetime.now(UTC).astimezone(zone_for(timezone)).date()
    begin, finish = report_bounds(start or today.replace(day=1), end or today, timezone)
    rows = list(await session.execute(select_usage_totals(begin, finish)))
    by_user: dict[str, list[UsageModelTotal]] = defaultdict(list)
    for row in rows:
        by_user[row.user_id].append(_model_total(row))
    people = {
        person.id: person
        for person in await session.execute(
            select(UserModel.id, UserModel.name, UserModel.email, UserModel.group_id, GroupModel.name.label("group"))
            .outerjoin(GroupModel, GroupModel.id == UserModel.group_id)
            .where(UserModel.id.in_(list(by_user)))
        )
    }
    users: list[UsageUserRow] = []
    for user_id, models in by_user.items():
        person = people.get(user_id)
        users.append(
            UsageUserRow(
                user_id=user_id,
                name=(person.name if person else None) or "",
                email=(person.email if person else None) or "",
                group_id=person.group_id if person else None,
                group_name=person.group if person else None,
                models=models,
                total_tokens=sum(model.input_tokens + model.output_tokens for model in models),
                cost_usd=_sum_cost([model.cost_usd for model in models]),
            )
        )
    users.sort(key=lambda row: (-row.total_tokens, row.name.lower(), row.user_id))
    groups: dict[str | None, list[UsageUserRow]] = defaultdict(list)
    for row in users:
        groups[row.group_id].append(row)
    group_rows = [
        UsageGroupRow(
            group_id=group_id,
            group_name=members[0].group_name,
            users=len(members),
            total_tokens=sum(member.total_tokens for member in members),
            images=sum(model.images for member in members for model in member.models),
            cost_usd=_sum_cost([member.cost_usd for member in members]),
        )
        for group_id, members in groups.items()
    ]
    group_rows.sort(key=lambda row: (-row.total_tokens, (row.group_name or "").lower()))
    return UsageReport(
        timezone=timezone,
        start=begin,
        end=finish,
        users=users,
        groups=group_rows,
        total_tokens=sum(row.total_tokens for row in users),
        cost_usd=_sum_cost([row.cost_usd for row in users]),
    )
