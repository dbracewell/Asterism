"""Record usage, compute budget windows, and refuse work over budget (ADR-0073).

Days and months follow one instance timezone (``usage_timezone`` app setting,
UTC by default), so every user's budget resets at the same local midnight and
nobody can reset early by changing their own timezone. Budgets are tokens
(input plus output) per user, set on the user's group; the admin group has none.
A budget is checked when work is admitted; work already running finishes even
if it goes over.
"""

import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException
from asterism.db.database import get_async_db_session
from asterism.domains.groups.models import ADMIN_GROUP, GroupModel
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.user.models import UserModel

from .models import UsageRecordModel
from .schemas import UsageMeter, UsageSettings, UsageWindow

logger = get_logger("Usage")

TIMEZONE_KEY = "usage_timezone"
DEFAULT_TIMEZONE = "UTC"


class UsageLimitExceeded(ConflictException):
    """HTTP 409: the user's daily or monthly token budget is used up."""

    reason = "usage_limit"

    def __init__(self, message: str, resets_at: int) -> None:
        super().__init__(message)
        self.resets_at = resets_at

    def packet(self) -> dict:
        """The same refusal on the chat WebSocket (regenerate), shaped like other stream errors."""
        return {
            "type": "error",
            "code": self.code,
            "error_code": self.reason,
            "retryable": False,
            "content": str(self),
            "resets_at": self.resets_at,
        }


async def record_usage(
    meter: UsageMeter,
    *,
    input_tokens: int = 0,
    output_tokens: int = 0,
    images: int = 0,
) -> None:
    """Append one ledger row in its own transaction. A failure is logged, never raised to the call."""
    if input_tokens <= 0 and output_tokens <= 0 and images <= 0:
        return
    pricing = None if meter.plan else meter.pricing
    try:
        async with get_async_db_session() as session:
            await session.execute(
                insert(UsageRecordModel).values(
                    id=uuid.uuid4(),
                    user_id=meter.user_id,
                    source=meter.source.value,
                    model_id=meter.model_id,
                    model_name=meter.model_name[:255],
                    chat_id=meter.chat_id,
                    input_tokens=max(input_tokens, 0),
                    output_tokens=max(output_tokens, 0),
                    images=max(images, 0),
                    input_price_per_million=pricing.input_per_million if pricing else None,
                    output_price_per_million=pricing.output_per_million if pricing else None,
                    plan=meter.plan,
                )
            )
            await session.commit()
    except Exception:
        logger.exception("Could not record usage user=%s source=%s", meter.user_id, meter.source.value)


def zone_for(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise BadDataException(f"Unknown timezone {name!r}; use an IANA name such as Europe/London") from error


async def read_usage_settings(session: AsyncSession) -> UsageSettings:
    row = await session.get(ApplicationSettingsModel, TIMEZONE_KEY)
    name = row.value if row is not None and isinstance(row.value, str) else DEFAULT_TIMEZONE
    try:
        zone_for(name)
    except BadDataException:
        logger.warning("Stored usage timezone %r is unknown; using UTC", name)
        name = DEFAULT_TIMEZONE
    return UsageSettings(timezone=name)


async def update_usage_settings(settings: UsageSettings, session: AsyncSession) -> UsageSettings:
    zone_for(settings.timezone)
    row = await session.get(ApplicationSettingsModel, TIMEZONE_KEY)
    if row is None:
        session.add(ApplicationSettingsModel(key=TIMEZONE_KEY, value=settings.timezone))
    else:
        row.value = settings.timezone
    await session.commit()
    return settings


def day_bounds(now: datetime, zone: ZoneInfo) -> tuple[int, int]:
    """Unix seconds of local midnight today and tomorrow (23 or 25 hours apart across DST changes)."""
    local = now.astimezone(zone)
    start = datetime(local.year, local.month, local.day, tzinfo=zone)
    following = start.date() + timedelta(days=1)
    end = datetime(following.year, following.month, following.day, tzinfo=zone)
    return int(start.timestamp()), int(end.timestamp())


def month_bounds(now: datetime, zone: ZoneInfo) -> tuple[int, int]:
    """Unix seconds of local midnight on the first of this month and of next month."""
    local = now.astimezone(zone)
    start = datetime(local.year, local.month, 1, tzinfo=zone)
    year, month = (local.year + 1, 1) if local.month == 12 else (local.year, local.month + 1)
    end = datetime(year, month, 1, tzinfo=zone)
    return int(start.timestamp()), int(end.timestamp())


async def used_tokens(user_id: str, since: int, session: AsyncSession, until: int | None = None) -> int:
    query = select(func.coalesce(func.sum(UsageRecordModel.input_tokens + UsageRecordModel.output_tokens), 0)).where(
        UsageRecordModel.user_id == user_id, UsageRecordModel.created_at >= since
    )
    if until is not None:
        query = query.where(UsageRecordModel.created_at < until)
    return int(await session.scalar(query) or 0)


async def read_budget(user_id: str, session: AsyncSession) -> tuple[bool, int | None, int | None]:
    """(exempt, daily tokens, monthly tokens) from the user's group; admins are exempt."""
    row = (
        await session.execute(
            select(GroupModel.id, GroupModel.daily_token_budget, GroupModel.monthly_token_budget)
            .join(UserModel, UserModel.group_id == GroupModel.id)
            .where(UserModel.id == user_id)
        )
    ).first()
    if row is None:
        return False, None, None
    if row.id == ADMIN_GROUP:
        return True, None, None
    return False, row.daily_token_budget, row.monthly_token_budget


def _window(used: int, budget: int | None, bounds: tuple[int, int]) -> UsageWindow:
    return UsageWindow(
        used_tokens=used,
        budget_tokens=budget,
        remaining_tokens=None if budget is None else max(budget - used, 0),
        starts_at=bounds[0],
        resets_at=bounds[1],
    )


async def _windows(
    user_id: str, timezone: str, daily: int | None, monthly: int | None, session: AsyncSession, now: datetime | None
) -> tuple[UsageWindow, UsageWindow]:
    zone = zone_for(timezone)
    moment = now or datetime.now(UTC)
    day, month = day_bounds(moment, zone), month_bounds(moment, zone)
    month_used = await used_tokens(user_id, month[0], session)
    # Usage is only recorded up to now, so the open day needs no upper bound.
    day_used = await used_tokens(user_id, day[0], session)
    return _window(day_used, daily, day), _window(month_used, monthly, month)


async def budget_windows(
    user_id: str, session: AsyncSession, now: datetime | None = None
) -> tuple[str, bool, UsageWindow, UsageWindow]:
    """The instance timezone, exemption, and today's and this month's windows for one user."""
    timezone = (await read_usage_settings(session)).timezone
    exempt, daily, monthly = await read_budget(user_id, session)
    day, month = await _windows(user_id, timezone, daily, monthly, session, now)
    return timezone, exempt, day, month


def _when(timestamp: int, timezone: str) -> str:
    local = datetime.fromtimestamp(timestamp, zone_for(timezone))
    return f"{local:%Y-%m-%d %H:%M} ({timezone})"


async def require_within_budget(user_id: str, session: AsyncSession, now: datetime | None = None) -> None:
    """Refuse new work when today's or this month's budget is used up; one 409 shape for every path."""
    exempt, daily, monthly = await read_budget(user_id, session)
    if exempt or (daily is None and monthly is None):
        return
    timezone = (await read_usage_settings(session)).timezone
    day, month = await _windows(user_id, timezone, daily, monthly, session, now)
    for label, window in (("monthly", month), ("daily", day)):
        if window.budget_tokens is not None and window.used_tokens >= window.budget_tokens:
            raise UsageLimitExceeded(
                f"You've used your {label} budget of {window.budget_tokens:,} tokens. "
                f"It resets {_when(window.resets_at, timezone)}.",
                resets_at=window.resets_at,
            )
