import datetime
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel

from asterism.common import NoArgs, ToolContext
from asterism.registries import tool_registry


@tool_registry.tool(
    name="get_current_timestamp",
    description="Get's the current timestamp in utc, iso, and user_local_iso",
)
async def get_current_timestamp(ctx: ToolContext[NoArgs]) -> dict[str, Any]:
    now = datetime.datetime.now(datetime.timezone.utc)
    result: dict[str, Any] = {
        "current_timestamp": int(now.timestamp()),
        "current_iso": now.isoformat(),
    }

    if ctx.user.timezone:
        try:
            tz = ZoneInfo(ctx.user.timezone)  # type: ignore
            user_now = now.astimezone(tz)
            result["user_local_iso"] = user_now.isoformat()
            result["user_timezone"] = ctx.user.timezone
        except Exception:
            pass

    return result


class TimezoneArgs(BaseModel):
    timezone: Annotated[str, "The timezone to get the time for"]


@tool_registry.tool(
    name="get_timestamp_at_timezone",
    description="Get's the current timestamp in a given timezone.",
)
async def get_timestamp_at_timezone(
    ctx: ToolContext[TimezoneArgs],
) -> dict[str, Any]:
    now = datetime.datetime.now(datetime.timezone.utc)
    result: dict[str, Any] = {}
    try:
        tz = ZoneInfo(ctx.args.timezone)  # type: ignore
        user_now = now.astimezone(tz)
        result["current_timestamp"] = user_now.isoformat()
        result["timezone"] = ctx.args.timezone
    except Exception as e:
        return {"error": str(e)}
        pass

    return result
