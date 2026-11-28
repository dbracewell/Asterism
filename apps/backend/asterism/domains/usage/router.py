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
    group_id: str | None = Query(default=None, max_length=32, description="Only this group's users"),
    search: str | None = Query(default=None, max_length=320, description="Users whose name, email or id contains this"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=reports.MAX_PAGE_SIZE),
) -> UsageReport:
    """Tokens and estimated cost per group and in total over a period of days, and one page of users."""
    return await reports.usage_report(
        db, start=start, end=end, group_id=group_id, search=search, page=page, page_size=page_size
    )


@usage_router.get("/settings", response_model=UsageSettings, operation_id="usageSettingsGet")
async def read_settings(user: AdminUserDep, db: DBSessionDep) -> UsageSettings:
    return await service.read_usage_settings(db)


@usage_router.put("/settings", response_model=UsageSettings, operation_id="usageSettingsUpdate")
async def update_settings(payload: UsageSettings, user: AdminUserDep, db: DBSessionDep) -> UsageSettings:
    """Set the timezone whose midnight starts each budget day and month for everyone."""
    return await service.update_usage_settings(payload, db)
