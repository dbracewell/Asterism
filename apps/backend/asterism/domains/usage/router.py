"""Usage endpoints: your own usage, the admin report, and the usage timezone (US-86.3)."""

from datetime import date

from fastapi import APIRouter, Query

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep, AuthedUserDep

from . import reports, service
from .schemas import MyUsage, UsageReport, UsageSettings

usage_router = APIRouter(
    prefix="/usage",
    tags=["usage"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}, 403: {"model": ErrorDetail}},
)


@usage_router.get("/me", response_model=MyUsage, operation_id="usageGetMine")
async def my_usage(user: AuthedUserDep, db: DBSessionDep) -> MyUsage:
    """Your tokens today and this month, your budget, and when each resets."""
    return await reports.my_usage(user.id, db)


@usage_router.get("/report", response_model=UsageReport, operation_id="usageGetReport")
async def usage_report(
    user: AdminUserDep,
    db: DBSessionDep,
    start: date | None = Query(
        default=None, description="First day, in the usage timezone; default: 1st of this month"
    ),
    end: date | None = Query(default=None, description="Last day, included; default: today"),
) -> UsageReport:
    """Tokens and estimated cost per user and model, and per group, over a period of days."""
    return await reports.usage_report(start, end, db)


@usage_router.get("/settings", response_model=UsageSettings, operation_id="usageSettingsGet")
async def read_settings(user: AdminUserDep, db: DBSessionDep) -> UsageSettings:
    return await service.read_usage_settings(db)


@usage_router.put("/settings", response_model=UsageSettings, operation_id="usageSettingsUpdate")
async def update_settings(payload: UsageSettings, user: AdminUserDep, db: DBSessionDep) -> UsageSettings:
    """Set the timezone whose midnight starts each budget day and month for everyone."""
    return await service.update_usage_settings(payload, db)
