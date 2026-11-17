"""Topic mastery from study results (US-58.3, ADR-0049, ADR-0067).

Topics are deck and quiz tags, matched case-insensitively. A topic's items are
the cards of its decks and the original questions of its quizzes; practice
copies count towards the item they re-ask. Each item's latest graded outcome
gives a 0–1 score (quiz verdicts, card ratings). Mastery is the mean over the
items practiced so far, with coverage and a weekly trend. Everything is derived
on read from review logs and quiz answers, never from chat content, and nothing
is stored or read by agents.

Topic practice copies a topic's weakest items without a model call, like
weak-spot practice. Callers check project ownership.
"""

import random
import uuid
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, NotFoundException

from .queries import (
    select_cards_by_id,
    select_owned_decks,
    select_owned_quizzes,
    select_questions_by_id,
    select_scored_events,
    select_tagged_cards,
    select_tagged_questions,
)
from .quizzes import QuestionDraft
from .schemas import MasteryLevel, StudyTopicMastery, StudyTrendPoint
from .weak_spots import Item, copy_card, copy_question, live_files

TREND_WEEKS = 8
WEEK = 7 * 24 * 60 * 60
MASTERED_SCORE = 0.8
MASTERED_COVERAGE = 0.8
NEEDS_WORK_SCORE = 0.5


@dataclass
class Topic:
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


async def load_topics(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> dict[str, Topic]:
    topics: dict[str, Topic] = {}

    def topic(tag: str) -> Topic:
        return topics.setdefault(tag.casefold(), Topic(label=tag))

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


async def load_history(
    *, user_id: str, project_id: uuid.UUID, session: AsyncSession
) -> dict[Item, list[tuple[int, float]]]:
    history: dict[Item, list[tuple[int, float]]] = defaultdict(list)
    for kind, root_id, at, score in (
        await session.execute(select_scored_events(user_id=user_id, project_id=project_id))
    ).tuples():
        history[(kind, root_id)].append((at, float(score)))
    return history


def topic_mastery(
    topics: dict[str, Topic], history: dict[Item, list[tuple[int, float]]], now: int
) -> list[StudyTopicMastery]:
    """Each topic's level, score, coverage and weekly trend, by label."""
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
    return items


def item_topics(topics: dict[str, Topic]) -> dict[Item, list[str]]:
    """The topic keys of each item, in topic order."""
    keys: dict[Item, list[str]] = defaultdict(list)
    for key, entry in sorted(topics.items(), key=lambda pair: pair[1].label.casefold()):
        for item in dict.fromkeys(entry.items):
            keys[item].append(key)
    return keys


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


async def topic_drafts(
    *, user_id: str, project_id: uuid.UUID, topic: str, count: int, session: AsyncSession, rng: random.Random
) -> tuple[str, list[QuestionDraft]]:
    """The topic's label and copies of its ``count`` weakest items; 404 for an unknown topic, 400 with no items."""
    topics = await load_topics(user_id=user_id, project_id=project_id, session=session)
    entry = topics.get(" ".join(topic.split()).casefold())
    if entry is None:
        raise NotFoundException("Topic not found")
    if not entry.items:
        raise BadDataException("This topic has no cards or questions to practice yet")
    history = await load_history(user_id=user_id, project_id=project_id, session=session)
    chosen = list(dict.fromkeys(practice_order(entry.items, history)))[:count]
    card_ids = [item_id for kind, item_id in chosen if kind == "card"]
    question_ids = [item_id for kind, item_id in chosen if kind == "question"]
    cards = {card.id: card for card in await session.scalars(select_cards_by_id(user_id=user_id, card_ids=card_ids))}
    questions = {
        question.id: question
        for question in await session.scalars(select_questions_by_id(user_id=user_id, question_ids=question_ids))
    }
    stored = [row.citations for row in [*cards.values(), *questions.values()]]
    members = await live_files(user_id=user_id, project_id=project_id, stored=stored, session=session)
    drafts = [
        copy_card(cards[item_id], members)
        if kind == "card"
        else copy_question(questions[item_id], "question", item_id, members, rng)
        for kind, item_id in chosen
    ]
    return entry.label, drafts
