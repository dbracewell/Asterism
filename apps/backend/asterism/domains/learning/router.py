"""Read-only catalog of server-owned learning modes; instruction text stays private."""

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.domains.user.dependencies import AuthedUserDep

from .catalog import LEARNING_MODES
from .schemas import FeedbackSection, LearningMode, LearningModeCatalog, RubricFeedbackFormat

learning_router = APIRouter(
    prefix="/learning-modes",
    tags=["learning-modes"],
    responses={401: {"model": ErrorDetail}},
)


@learning_router.get("", operation_id="learningModeGetMany")
async def list_learning_modes(user: AuthedUserDep) -> LearningModeCatalog:
    return LearningModeCatalog(
        modes=[
            LearningMode(
                id=item.id,
                name=item.name,
                description=item.description,
                version=item.version,
                hint_levels=list(item.raisable_hint_levels),
                feedback_sections=[
                    FeedbackSection(id=section.id, heading=section.heading) for section in item.feedback_sections
                ],
                rubric_feedback=(
                    RubricFeedbackFormat(
                        level_label=item.rubric_feedback.level_label,
                        overall_heading=item.rubric_feedback.overall_heading,
                    )
                    if item.rubric_feedback
                    else None
                ),
            )
            for item in LEARNING_MODES.values()
        ]
    )
