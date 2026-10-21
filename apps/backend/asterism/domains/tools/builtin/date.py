"""Time-related tools: current timestamp and timezone-rendered time."""

import datetime
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from asterism.core.schemas import NoArgs
from asterism.domains.tools.registry import ToolContext, tool_registry


@tool_registry.tool(
    name="get_current_timestamp",
    description="Gets the current timestamp in UTC, ISO, and user-local time.",
)
async def get_current_timestamp(ctx: ToolContext[NoArgs]) -> dict[str, Any]:
    """Return the current time as UTC epoch seconds and ISO 8601.

    Also includes ``user_local_iso``/``user_timezone`` when the user has a
    valid timezone configured; invalid zones are skipped silently rather than
    failing the tool call.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    result: dict[str, Any] = {
        "current_timestamp": int(now.timestamp()),
        "current_iso": now.isoformat(),
    }

    if ctx.user.timezone:
        try:
            tz = ZoneInfo(ctx.user.timezone)
            user_now = now.astimezone(tz)
            result["user_local_iso"] = user_now.isoformat()
            result["user_timezone"] = ctx.user.timezone
        except Exception:
            pass

    return result


class TimezoneArgs(BaseModel):
    """Arguments for get_timestamp_at_timezone."""

    timezone: Annotated[str, "The timezone to get the time for (IANA name, e.g. 'Europe/Berlin')"]


@tool_registry.tool(
    name="get_timestamp_at_timezone",
    description="Gets the current timestamp in a given timezone.",
)
async def get_timestamp_at_timezone(
    ctx: ToolContext[TimezoneArgs],
) -> dict[str, Any]:
    """Return the current time rendered in a caller-supplied IANA timezone.

    Mirrors get_current_timestamp's contract: ``current_timestamp`` is epoch
    seconds and ``current_iso`` is the ISO 8601 rendering in the requested zone.
    Returns an ``{"error": ...}`` dict (instead of raising) when the timezone
    name is invalid, so the model can see and recover from the failure.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        tz = ZoneInfo(ctx.args.timezone)
    except Exception as e:
        return {"error": str(e)}

    user_now = now.astimezone(tz)
    return {
        "current_timestamp": int(user_now.timestamp()),
        "current_iso": user_now.isoformat(),
        "timezone": ctx.args.timezone,
    }
