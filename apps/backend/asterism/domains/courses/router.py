"""HTTP surface for course packs: educators publish, students add and update."""

import uuid

from fastapi import APIRouter, Query, status

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import copies, publish
from .schemas import CourseApplied, CourseApply, CourseOffer, CoursePublish, CourseVersion, CourseVersionPage

ERRORS = {
    400: {"model": ErrorDetail},
    401: {"model": ErrorDetail},
    403: {"model": ErrorDetail},
    404: {"model": ErrorDetail},
    409: {"model": ErrorDetail},
}

courses_router = APIRouter(prefix="/classes", tags=["classes"], responses=ERRORS)


@courses_router.get("/joined/{class_id}/course", response_model=CourseOffer | None, operation_id="classCourseGet")
async def get_course(class_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> CourseOffer | None:
    """The latest course for a class you're in, what it would give you, and what changed. None if unpublished."""
    return await copies.read_offer(user.id, class_id, db)


@courses_router.post("/joined/{class_id}/course", response_model=CourseApplied, operation_id="classCourseApply")
async def apply_course(
    class_id: uuid.UUID, payload: CourseApply, user: AuthedUserDep, db: DBSessionDep
) -> CourseApplied:
    """Add the course to your projects, or update your copy to the version you reviewed."""
    return await copies.apply_course(user.id, class_id, payload.version_number, db)


@courses_router.post(
    "/{class_id}/course",
    response_model=CourseVersion,
    status_code=status.HTTP_201_CREATED,
    operation_id="classCoursePublish",
)
async def publish_course(
    class_id: uuid.UUID, payload: CoursePublish, user: AuthedUserDep, db: DBSessionDep
) -> CourseVersion:
    """Publish one of your projects as the next course version."""
    return await publish.publish(user.id, class_id, payload, db)


@courses_router.get(
    "/{class_id}/course/versions", response_model=CourseVersionPage, operation_id="classCourseVersionGetMany"
)
async def list_versions(
    class_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> CourseVersionPage:
    return await publish.list_versions(user.id, class_id, db, page=page, page_size=page_size)
