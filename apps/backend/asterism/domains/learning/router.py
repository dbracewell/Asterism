"""Read-only catalog of server-owned learning modes; instruction text stays private."""

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.domains.user.dependencies import AuthedUserDep

from .catalog import LEARNING_MODES
from .schemas import LearningMode, LearningModeCatalog

learning_router = APIRouter(
    prefix="/learning-modes",
    tags=["learning-modes"],
    responses={401: {"model": ErrorDetail}},
)


@learning_router.get("", operation_id="learningModeGetMany")
async def list_learning_modes(user: AuthedUserDep) -> LearningModeCatalog:
    return LearningModeCatalog(
        modes=[
            LearningMode(id=item.id, name=item.name, description=item.description, version=item.version)
            for item in LEARNING_MODES.values()
        ]
    )
