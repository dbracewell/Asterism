"""Owner- and project-scoped quiz lifecycle (US-53.4, ADR-0035).

Every operation first proves project ownership, then quiz membership in that
project. Foreign and missing records are indistinguishable 404s. Questions are
fixed once a quiz is generated; only the title changes.
"""

import json
import uuid
from dataclasses import dataclass

from pydantic import TypeAdapter
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import NotFoundException
from asterism.db.queries import paginate_select
from asterism.domains.projects.scope import require_owned_project

from .models import StudyQuizModel, StudyQuizQuestionModel
from .queries import attempt_stats_by_quiz, count_questions_by_quiz, select_owned_quizzes, select_quiz_questions
from .schemas import (
    StudyCitationInput,
    StudyQuestionKind,
    StudyQuiz,
    StudyQuizPage,
    StudyQuizQuestion,
    StudyQuizSummary,
    StudyQuizUpdate,
)

logger = get_logger("StudyQuizzes")

_options = TypeAdapter(list[str])
_citations = TypeAdapter(list[StudyCitationInput])


@dataclass(frozen=True)
class QuestionDraft:
    """A parsed, validated question ready to store."""

    kind: StudyQuestionKind
    prompt: str
    options: list[str]
    correct_option: int | None
    rubric: str
    explanation: str
    citations: list[StudyCitationInput]


def question_options(row: StudyQuizQuestionModel) -> list[str]:
    return _options.validate_json(row.options)


# --- Lookups ---------------------------------------------------------------


async def require_quiz(
    *, user_id: str, project_id: uuid.UUID, quiz_id: uuid.UUID, session: AsyncSession
) -> StudyQuizModel:
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    quiz = await session.scalar(
        select_owned_quizzes(user_id=user_id, project_id=project_id).where(StudyQuizModel.id == quiz_id)
    )
    if quiz is None:
        raise NotFoundException("Quiz not found")
    return quiz


async def quiz_questions(*, user_id: str, quiz_id: uuid.UUID, session: AsyncSession) -> list[StudyQuizQuestionModel]:
    return list(await session.scalars(select_quiz_questions(user_id=user_id, quiz_id=quiz_id)))


# --- Response enrichment ---------------------------------------------------


async def _to_summaries(*, user_id: str, rows: list[StudyQuizModel], session: AsyncSession) -> list[StudyQuizSummary]:
    kinds: dict[uuid.UUID, dict[str, int]] = {}
    stats: dict[uuid.UUID, tuple[int, float | None, float | None]] = {}
    if rows:
        quiz_ids = [row.id for row in rows]
        for quiz_id, kind, count in (
            await session.execute(count_questions_by_quiz(user_id=user_id, quiz_ids=quiz_ids))
        ).tuples():
            kinds.setdefault(quiz_id, {})[kind] = count
        for quiz_id, count, best, last in (
            await session.execute(attempt_stats_by_quiz(user_id=user_id, quiz_ids=quiz_ids))
        ).tuples():
            stats[quiz_id] = (count, best, last)
    summaries = []
    for row in rows:
        counts = kinds.get(row.id, {})
        attempts, best, last = stats.get(row.id, (0, None, None))
        summaries.append(
            StudyQuizSummary(
                id=row.id,
                project_id=row.project_id,
                title=row.title,
                question_count=sum(counts.values()),
                multiple_choice_count=counts.get("multiple_choice", 0),
                short_answer_count=counts.get("short_answer", 0),
                attempt_count=attempts,
                last_score=last,
                best_score=best,
                model_id=row.model_id,
                model_name=row.model_name,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
        )
    return summaries


async def to_quiz(*, user_id: str, quiz: StudyQuizModel, session: AsyncSession) -> StudyQuiz:
    """The quiz as shown while taking it: questions without answer keys or sources."""
    summary = (await _to_summaries(user_id=user_id, rows=[quiz], session=session))[0]
    questions = await quiz_questions(user_id=user_id, quiz_id=quiz.id, session=session)
    return StudyQuiz(
        **summary.model_dump(),
        questions=[
            StudyQuizQuestion(
                id=row.id,
                position=row.position,
                kind=row.kind,  # pyright: ignore[reportArgumentType]  # DB check constraint pins the values.
                prompt=row.prompt,
                options=question_options(row),
            )
            for row in questions
        ],
    )


# --- Lifecycle -------------------------------------------------------------


async def list_quizzes(
    *, user_id: str, project_id: uuid.UUID, page: int, page_size: int, session: AsyncSession
) -> StudyQuizPage:
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    result = await paginate_select(
        statement=select_owned_quizzes(user_id=user_id, project_id=project_id).order_by(
            StudyQuizModel.created_at.desc(), StudyQuizModel.id
        ),
        session=session,
        page=page,
        page_size=page_size,
    )
    return StudyQuizPage(
        items=await _to_summaries(user_id=user_id, rows=result.records, session=session),
        total=result.total,
        page=page,
        page_size=page_size,
    )


async def read_quiz(*, user_id: str, project_id: uuid.UUID, quiz_id: uuid.UUID, session: AsyncSession) -> StudyQuiz:
    quiz = await require_quiz(user_id=user_id, project_id=project_id, quiz_id=quiz_id, session=session)
    return await to_quiz(user_id=user_id, quiz=quiz, session=session)


async def update_quiz(
    *, user_id: str, project_id: uuid.UUID, quiz_id: uuid.UUID, payload: StudyQuizUpdate, session: AsyncSession
) -> StudyQuiz:
    quiz = await require_quiz(user_id=user_id, project_id=project_id, quiz_id=quiz_id, session=session)
    quiz.title = payload.title
    await session.commit()
    return await to_quiz(user_id=user_id, quiz=quiz, session=session)


async def delete_quiz(*, user_id: str, project_id: uuid.UUID, quiz_id: uuid.UUID, session: AsyncSession) -> None:
    await require_quiz(user_id=user_id, project_id=project_id, quiz_id=quiz_id, session=session)
    # Questions, attempts and answers cascade through the composite foreign keys.
    await session.execute(
        delete(StudyQuizModel).where(
            StudyQuizModel.id == quiz_id,
            StudyQuizModel.user_id == user_id,
            StudyQuizModel.project_id == project_id,
        )
    )
    await session.commit()
    logger.info(f"Deleted study quiz {quiz_id} in project {project_id} for user {user_id}")


async def save_quiz(
    *,
    user_id: str,
    project_id: uuid.UUID,
    title: str,
    model_id: uuid.UUID,
    model_name: str,
    questions: list[QuestionDraft],
    session: AsyncSession,
) -> StudyQuizModel:
    """Store a generated quiz and its questions in one transaction.

    The caller has already checked every citation against the live project scope.
    """
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    quiz = StudyQuizModel(user_id=user_id, project_id=project_id, title=title, model_id=model_id, model_name=model_name)
    session.add(quiz)
    await session.flush()
    session.add_all(
        StudyQuizQuestionModel(
            user_id=user_id,
            quiz_id=quiz.id,
            position=position,
            kind=question.kind,
            prompt=question.prompt,
            options=json.dumps(question.options),
            correct_option=question.correct_option,
            rubric=question.rubric,
            explanation=question.explanation,
            citations=_citations.dump_json(question.citations).decode(),
        )
        for position, question in enumerate(questions)
    )
    await session.commit()
    logger.info(f"Created study quiz {quiz.id} in project {project_id} for user {user_id}")
    return quiz
