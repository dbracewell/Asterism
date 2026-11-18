"""``GET /health/ready`` (public) and ``GET /status`` (admin)."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from asterism.core.schemas import ErrorDetail
from asterism.domains.user.dependencies import AdminUserDep

from . import service
from .schemas import InstanceStatus, Readiness

status_router = APIRouter(tags=["status"])


@status_router.get(
    "/health/ready",
    response_model=Readiness,
    operation_id="healthReady",
    responses={503: {"model": Readiness}},
)
async def ready() -> JSONResponse:
    """200 when the backend can serve: database writable, storage free space, auth keys loadable; else 503."""
    result = await service.readiness()
    return JSONResponse(result.model_dump(), status_code=200 if result.ready else 503)


@status_router.get(
    "/status",
    response_model=InstanceStatus,
    operation_id="statusGet",
    responses={401: {"model": ErrorDetail}},
)
async def instance_status(user: AdminUserDep) -> InstanceStatus:
    """Version, uptime, chat admission, knowledge queue, storage and last backup."""
    return await service.instance_status()
