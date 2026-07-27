import datetime
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from asterism.core.registries.tool import ArgDesc, tool_registry
from asterism.core.typedefs import AuthedUser


@tool_registry.tool(
    name="get_current_timestamp",
    description="Get's the current timestamp in utc, iso, and user_local_iso",
)
def get_current_timestamp(user: AuthedUser) -> dict[str, Any]:
    now = datetime.datetime.now(datetime.timezone.utc)
    result: dict[str, Any] = {
        "current_timestamp": int(now.timestamp()),
        "current_iso": now.isoformat(),
    }
    try:
        tz = ZoneInfo(user.timezone)  # type: ignore
        user_now = now.astimezone(tz)
        result["user_local_iso"] = user_now.isoformat()
        result["user_timezone"] = user.timezone
    except Exception:
        pass

    return result


@tool_registry.tool(
    name="get_timestamp_at_timezone",
    description="Get's the current timestamp in a given timezone.",
)
def get_timestamp_at_timezone(
    timezone: Annotated[str, ArgDesc("The timezone to get the time for")],
) -> dict[str, Any]:
    now = datetime.datetime.now(datetime.timezone.utc)
    result: dict[str, Any] = {}
    try:
        tz = ZoneInfo(timezone)  # type: ignore
        user_now = now.astimezone(tz)
        result["current_timestamp"] = user_now.isoformat()
        result["timezone"] = timezone
    except Exception:
        pass

    return result
