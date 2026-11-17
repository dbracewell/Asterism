"""One practice route for weak spots and topics (ADR-0067).

Practice copies items into a quiz without a model call: with a topic, that
topic's weakest items first (ADR-0049); without one, the most recent weak spots
(ADR-0036). Both save a ``practice`` quiz; copies name their originals.
"""

import random
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.domains.projects.scope import require_owned_project

from . import mastery, weak_spots
from .quizzes import save_quiz, to_quiz
from .schemas import MAX_QUIZ_TITLE_CHARS, StudyPracticeRequest, StudyQuiz

logger = get_logger("StudyPractice")

WEAK_SPOTS_TITLE = "Practice: weak spots"


async def practice(
    *,
    user_id: str,
    project_id: uuid.UUID,
    request: StudyPracticeRequest,
    session: AsyncSession,
    rng: random.Random | None = None,
) -> StudyQuiz:
    """Save a practice quiz; 404 for an unknown topic, 400 when there is nothing to practice."""
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    rng = rng or random.Random()
    if request.topic is None:
        title, tags = WEAK_SPOTS_TITLE, []
        drafts = await weak_spots.weak_spot_drafts(
            user_id=user_id, project_id=project_id, count=request.question_count, session=session, rng=rng
        )
    else:
        label, drafts = await mastery.topic_drafts(
            user_id=user_id,
            project_id=project_id,
            topic=request.topic,
            count=request.question_count,
            session=session,
            rng=rng,
        )
        title, tags = f"Practice: {label}"[:MAX_QUIZ_TITLE_CHARS], [label]
    quiz = await save_quiz(
        user_id=user_id,
        project_id=project_id,
        title=title,
        origin="practice",
        model_id=None,
        model_name=None,
        questions=drafts,
        session=session,
        tags=tags,
    )
    logger.info(f"Built practice quiz {quiz.id} with {len(drafts)} questions for user {user_id}")
    return await to_quiz(user_id=user_id, quiz=quiz, session=session)
