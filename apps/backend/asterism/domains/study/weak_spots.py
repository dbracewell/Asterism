"""Weak spots and weak-spot practice (US-53.5, ADR-0036).

A weak spot is a quiz question or card whose latest outcome in the project was a
miss: an incorrect or partly correct answer, or an Again rating. Any later
success clears it, including answering a weak-spot copy. Weak spots are derived
on read from attempts and review logs; nothing is stored, and no agent or prompt
path reads them.

Practice builds a quiz by copying the weak items, without a model call: missed
questions are re-asked (multiple-choice options reshuffled) and weak cards become
short-answer questions graded against the card's back.
"""

import random
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException
from asterism.domains.projects.scope import project_member_files, require_owned_project

from .citations import parse_citations, resolve_citations
from .models import StudyCardModel, StudyQuizQuestionModel
from .queries import select_cards_with_deck_name, select_questions_with_quiz_title, select_weak_spots
from .quizzes import QuestionDraft, question_options, save_quiz, to_quiz
from .schemas import StudyQuiz, StudyWeakSpot, StudyWeakSpotPracticeRequest, StudyWeakSpots

logger = get_logger("StudyWeakSpots")

PRACTICE_TITLE = "Weak spots practice"


@dataclass(frozen=True)
class _Row:
    root_kind: str
    root_id: uuid.UUID
    at: int
    outcome: str
    source_kind: str
    source_id: uuid.UUID


@dataclass(frozen=True)
class _Sources:
    questions: dict[uuid.UUID, tuple[StudyQuizQuestionModel, str]]
    cards: dict[uuid.UUID, tuple[StudyCardModel, str]]


async def _weak_rows(
    *, user_id: str, project_id: uuid.UUID, limit: int, session: AsyncSession
) -> tuple[list[_Row], int]:
    statement = select_weak_spots(user_id=user_id, project_id=project_id)
    total = await session.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    rows = [_Row(*row) for row in (await session.execute(statement.limit(limit))).tuples()]
    return rows, total or 0


async def _load_sources(*, user_id: str, rows: list[_Row], session: AsyncSession) -> _Sources:
    question_ids = [row.source_id for row in rows if row.source_kind == "question"]
    card_ids = [row.source_id for row in rows if row.source_kind == "card"]
    questions = {}
    if question_ids:
        result = await session.execute(select_questions_with_quiz_title(user_id=user_id, question_ids=question_ids))
        questions = {question.id: (question, title) for question, title in result.tuples()}
    cards = {}
    if card_ids:
        result = await session.execute(select_cards_with_deck_name(user_id=user_id, card_ids=card_ids))
        cards = {card.id: (card, name) for card, name in result.tuples()}
    return _Sources(questions, cards)


async def list_weak_spots(*, user_id: str, project_id: uuid.UUID, limit: int, session: AsyncSession) -> StudyWeakSpots:
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    rows, total = await _weak_rows(user_id=user_id, project_id=project_id, limit=limit, session=session)
    sources = await _load_sources(user_id=user_id, rows=rows, session=session)
    stored = [
        sources.questions[row.source_id][0].citations
        if row.source_kind == "question"
        else sources.cards[row.source_id][0].citations
        for row in rows
    ]
    citations = await resolve_citations(user_id=user_id, project_id=project_id, stored=stored, session=session)
    items = []
    for row, item_citations in zip(rows, citations, strict=True):
        if row.source_kind == "question":
            question, title = sources.questions[row.source_id]
            kind, prompt, container_id = question.kind, question.prompt, question.quiz_id
        else:
            card, title = sources.cards[row.source_id]
            kind, prompt, container_id = "card", card.front, card.deck_id
        items.append(
            StudyWeakSpot(
                root_kind=row.root_kind,  # pyright: ignore[reportArgumentType]  # Query literals pin the values.
                root_id=row.root_id,
                source_kind=row.source_kind,  # pyright: ignore[reportArgumentType]
                source_id=row.source_id,
                kind=kind,  # pyright: ignore[reportArgumentType]  # DB check constraint pins the values.
                prompt=prompt,
                outcome=row.outcome,  # pyright: ignore[reportArgumentType]  # Only misses are selected.
                missed_at=row.at,
                container_id=container_id,
                container_title=title,
                citations=item_citations,
            )
        )
    return StudyWeakSpots(items=items, total=total)


# --- Practice ----------------------------------------------------------------


def _copy_question(
    row: _Row, question: StudyQuizQuestionModel, members: set[uuid.UUID], rng: random.Random
) -> QuestionDraft:
    options, correct = question_options(question), question.correct_option
    if question.kind == "multiple_choice" and correct is not None:
        answer = options[correct]
        rng.shuffle(options)
        correct = options.index(answer)
    return QuestionDraft(
        kind=question.kind,  # pyright: ignore[reportArgumentType]  # DB check constraint pins the values.
        prompt=question.prompt,
        options=options,
        correct_option=correct,
        rubric=question.rubric,
        explanation=question.explanation,
        citations=[c for c in parse_citations(question.citations) if c.file_id in members],
        source_question_id=row.root_id if row.root_kind == "question" else None,
        source_card_id=row.root_id if row.root_kind == "card" else None,
    )


def _copy_card(card: StudyCardModel, members: set[uuid.UUID]) -> QuestionDraft:
    return QuestionDraft(
        kind="short_answer",
        prompt=card.front,
        options=[],
        correct_option=None,
        rubric=card.back,
        explanation="",
        citations=[c for c in parse_citations(card.citations) if c.file_id in members],
        source_card_id=card.id,
    )


async def practice_weak_spots(
    *,
    user_id: str,
    project_id: uuid.UUID,
    request: StudyWeakSpotPracticeRequest,
    session: AsyncSession,
    rng: random.Random | None = None,
) -> StudyQuiz:
    """Save a quiz of the most recent weak spots; 400 when there are none."""
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    rows, _ = await _weak_rows(user_id=user_id, project_id=project_id, limit=request.question_count, session=session)
    if not rows:
        raise BadDataException("There are no weak spots to practice yet")
    sources = await _load_sources(user_id=user_id, rows=rows, session=session)
    cited = {
        citation.file_id
        for value in [q.citations for q, _ in sources.questions.values()]
        + [c.citations for c, _ in sources.cards.values()]
        for citation in parse_citations(value)
    }
    # Copies keep only citations whose files are still in the project, as any write must.
    members = set(await project_member_files(user_id=user_id, project_id=project_id, file_ids=cited, session=session))
    rng = rng or random.Random()
    questions = [
        _copy_question(row, sources.questions[row.source_id][0], members, rng)
        if row.source_kind == "question"
        else _copy_card(sources.cards[row.source_id][0], members)
        for row in rows
    ]
    quiz = await save_quiz(
        user_id=user_id,
        project_id=project_id,
        title=PRACTICE_TITLE,
        origin="weak_spots",
        model_id=None,
        model_name=None,
        questions=questions,
        session=session,
    )
    logger.info(f"Built weak-spot quiz {quiz.id} with {len(questions)} questions for user {user_id}")
    return await to_quiz(user_id=user_id, quiz=quiz, session=session)
