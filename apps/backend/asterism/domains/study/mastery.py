"""Topic mastery from study results (US-58.3, ADR-0049).

Topics are deck and quiz tags, matched case-insensitively. A topic's items are
the cards of its decks and the original questions of its quizzes; practice
copies count towards the item they re-ask. Each item's latest graded outcome
gives a 0–1 score (quiz verdicts, card ratings). Mastery is the mean over the
items practiced so far, with coverage and a weekly trend. Everything is derived
on read from review logs and quiz answers, never from chat content, and nothing
is stored or read by agents.

Practice copies a topic's weakest items into a quiz without a model call, like
weak-spot practice.
"""

import random
import uuid
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.domains.projects.scope import project_member_files, require_owned_project

from . import clock
from .citations import parse_citations
from .queries import (
    select_cards_by_id,
    select_owned_decks,
    select_owned_quizzes,
    select_questions_by_id,
    select_scored_events,
    select_tagged_cards,
    select_tagged_questions,
)
from .quizzes import save_quiz, to_quiz
from .schemas import (
    MAX_QUIZ_TITLE_CHARS,
    MasteryLevel,
    StudyQuiz,
    StudyTopicMastery,
    StudyTopicMasteryList,
    StudyTopicPracticeRequest,
    StudyTrendPoint,
)
from .weak_spots import copy_card, copy_question

logger = get_logger("StudyMastery")

TREND_WEEKS = 8
WEEK = 7 * 24 * 60 * 60
MASTERED_SCORE = 0.8
MASTERED_COVERAGE = 0.8
NEEDS_WORK_SCORE = 0.5

Item = tuple[str, uuid.UUID]


@dataclass
class _Topic:
    label: str
    items: list[Item] = field(default_factory=list)
    decks: set[uuid.UUID] = field(default_factory=set)
    quizzes: set[uuid.UUID] = field(default_factory=set)


def level_for(score: float | None, coverage: float) -> MasteryLevel:
    if score is None:
        return "not_started"
    if score < NEEDS_WORK_SCORE:
        return "needs_work"
    if score >= MASTERED_SCORE and coverage >= MASTERED_COVERAGE:
        return "mastered"
    return "developing"


def latest_scores(items: list[Item], history: dict[Item, list[tuple[int, float]]], cutoff: int) -> dict[Item, float]:
    """Each item's latest score at or before ``cutoff``; unpracticed items are absent."""
    scores = {}
    for item in items:
        past = [score for at, score in history.get(item, ()) if at <= cutoff]
        if past:
            scores[item] = past[-1]
    return scores


def mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 4) if values else None


async def _topics(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> dict[str, _Topic]:
    topics: dict[str, _Topic] = {}

    def topic(tag: str) -> _Topic:
        return topics.setdefault(tag.casefold(), _Topic(label=tag))

    for deck in await session.scalars(select_owned_decks(user_id=user_id, project_id=project_id)):
        for tag in deck.tags:
            topic(tag).decks.add(deck.id)
    for quiz in await session.scalars(select_owned_quizzes(user_id=user_id, project_id=project_id)):
        for tag in quiz.tags:
            topic(tag).quizzes.add(quiz.id)
    for card_id, tags in (await session.execute(select_tagged_cards(user_id=user_id, project_id=project_id))).tuples():
        for tag in tags:
            topic(tag).items.append(("card", card_id))
    for question_id, tags in (
        await session.execute(select_tagged_questions(user_id=user_id, project_id=project_id))
    ).tuples():
        for tag in tags:
            topic(tag).items.append(("question", question_id))
    return topics


async def _history(
    *, user_id: str, project_id: uuid.UUID, session: AsyncSession
) -> dict[Item, list[tuple[int, float]]]:
    history: dict[Item, list[tuple[int, float]]] = defaultdict(list)
    for kind, root_id, at, score in (
        await session.execute(select_scored_events(user_id=user_id, project_id=project_id))
    ).tuples():
        history[(kind, root_id)].append((at, float(score)))
    return history


async def topic_mastery(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> StudyTopicMasteryList:
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    topics = await _topics(user_id=user_id, project_id=project_id, session=session)
    history = await _history(user_id=user_id, project_id=project_id, session=session)
    now = clock.now_seconds()
    cutoffs = [now - WEEK * weeks for weeks in range(TREND_WEEKS - 1, -1, -1)]
    items = []
    for key, entry in sorted(topics.items(), key=lambda pair: pair[1].label.casefold()):
        current = latest_scores(entry.items, history, now)
        score = mean(list(current.values()))
        coverage = len(current) / len(entry.items) if entry.items else 0.0
        items.append(
            StudyTopicMastery(
                key=key,
                label=entry.label,
                level=level_for(score, coverage),
                score=score,
                practiced=len(current),
                total=len(entry.items),
                deck_count=len(entry.decks),
                quiz_count=len(entry.quizzes),
                trend=[
                    StudyTrendPoint(at=cutoff, score=mean(list(latest_scores(entry.items, history, cutoff).values())))
                    for cutoff in cutoffs
                ],
            )
        )
    return StudyTopicMasteryList(items=items, computed_at=now)


def practice_order(items: list[Item], history: dict[Item, list[tuple[int, float]]]) -> list[Item]:
    """Weakest practiced items first, then unpracticed ones, then the rest by oldest practice."""

    def rank(position_item: tuple[int, Item]) -> tuple[int, float, int]:
        position, item = position_item
        events = history.get(item)
        if not events:
            return (1, 0.0, position)
        at, score = events[-1]
        return (0, score, at) if score < 1.0 else (2, float(at), position)

    return [item for _, item in sorted(enumerate(items), key=rank)]


async def practice_topic(
    *,
    user_id: str,
    project_id: uuid.UUID,
    request: StudyTopicPracticeRequest,
    session: AsyncSession,
    rng: random.Random | None = None,
) -> StudyQuiz:
    """Save a quiz of one topic's weakest items; 404 for an unknown topic, 400 when it has no items."""
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    topics = await _topics(user_id=user_id, project_id=project_id, session=session)
    entry = topics.get(" ".join(request.topic.split()).casefold())
    if entry is None:
        raise NotFoundException("Topic not found")
    if not entry.items:
        raise BadDataException("This topic has no cards or questions to practice yet")
    history = await _history(user_id=user_id, project_id=project_id, session=session)
    chosen = list(dict.fromkeys(practice_order(entry.items, history)))[: request.question_count]
    card_ids = [item_id for kind, item_id in chosen if kind == "card"]
    question_ids = [item_id for kind, item_id in chosen if kind == "question"]
    cards = {card.id: card for card in await session.scalars(select_cards_by_id(user_id=user_id, card_ids=card_ids))}
    questions = {
        question.id: question
        for question in await session.scalars(select_questions_by_id(user_id=user_id, question_ids=question_ids))
    }
    cited = {
        citation.file_id
        for row in [*cards.values(), *questions.values()]
        for citation in parse_citations(row.citations)
    }
    members = set(await project_member_files(user_id=user_id, project_id=project_id, file_ids=cited, session=session))
    rng = rng or random.Random()
    drafts = [
        copy_card(cards[item_id], members)
        if kind == "card"
        else copy_question(questions[item_id], "question", item_id, members, rng)
        for kind, item_id in chosen
    ]
    quiz = await save_quiz(
        user_id=user_id,
        project_id=project_id,
        title=f"Practice: {entry.label}"[:MAX_QUIZ_TITLE_CHARS],
        origin="topic",
        model_id=None,
        model_name=None,
        questions=drafts,
        session=session,
        tags=[entry.label],
    )
    logger.info(f"Built topic practice quiz {quiz.id} with {len(drafts)} questions for user {user_id}")
    return await to_quiz(user_id=user_id, quiz=quiz, session=session)
