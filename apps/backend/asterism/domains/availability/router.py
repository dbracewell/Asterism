"""``GET /availability``: what the admin lets the caller use (EPIC-96)."""

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import Availability
from .service import read_availability

availability_router = APIRouter(
    prefix="/availability",
    tags=["availability"],
    responses={401: {"model": ErrorDetail}},
)


@availability_router.get("", response_model=Availability, operation_id="availabilityGet")
async def my_availability(user: AuthedUserDep, session: DBSessionDep) -> Availability:
    """The admin's live switches for each feature, as they apply to the caller."""
    return await read_availability(user.id, session)
