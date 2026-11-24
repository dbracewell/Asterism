"""Admin endpoints for setup progress (US-101.2)."""

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep

from .schemas import SetupProgress, SetupStepUpdate
from .service import read_progress, record_step

setup_router = APIRouter(
    prefix="/settings/app/setup",
    tags=["setup"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}, 403: {"model": ErrorDetail}},
)


@setup_router.get("", operation_id="setupProgressGet")
async def get_progress(user: AdminUserDep, session: DBSessionDep) -> SetupProgress:
    return await read_progress(session)


@setup_router.put("/steps/{step_id}", operation_id="setupStepUpdate")
async def put_step(step_id: str, payload: SetupStepUpdate, user: AdminUserDep, session: DBSessionDep) -> SetupProgress:
    """Mark a step done or skipped, or reopen it (state null)."""
    return await record_step(step_id, payload, user.id, session)
