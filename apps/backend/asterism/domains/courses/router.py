"""HTTP surface for course packs: educators publish, students add and update."""

import uuid

from fastapi import APIRouter, Query, status

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import copies, publish
from .insights import ClassInsights, class_insights
from .policy import CourseModePolicy, course_mode_policy
from .schemas import CourseApplied, CourseApply, CourseOffer, CoursePublish, CourseVersion, CourseVersionPage

ERRORS = {
    400: {"model": ErrorDetail},
    401: {"model": ErrorDetail},
    403: {"model": ErrorDetail},
    404: {"model": ErrorDetail},
    409: {"model": ErrorDetail},
}

courses_router = APIRouter(prefix="/classes", tags=["classes"], responses=ERRORS)
course_policy_router = APIRouter(prefix="/course-policy", tags=["classes"], responses=ERRORS)


@course_policy_router.get(
    "/projects/{project_id}", response_model=CourseModePolicy | None, operation_id="courseModePolicyGet"
)
async def get_course_policy(project_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> CourseModePolicy | None:
    """The class policy limiting one of your projects, and who set it. None when nothing is limited."""
    policy = await course_mode_policy(user_id=user.id, project_id=project_id, session=db)
    return policy.view() if policy else None


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


@courses_router.get("/{class_id}/insights", response_model=ClassInsights, operation_id="classInsightsGet")
async def get_insights(class_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> ClassInsights:
    """Where consenting students struggle, by course file. Thresholded totals only."""
    return await class_insights(user.id, class_id, db)
