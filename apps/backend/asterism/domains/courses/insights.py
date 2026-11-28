"""Aggregate misconception insights for an educator (US-60.5, ADR-0056).

Topics are the course's files. For each consenting current member with a
course copy, the study domain gives their mean latest practice score on items
citing each of their copies of a course file. Those per-student numbers are
combined here and never leave this module: the educator sees only topics with
at least ``MIN_GROUP_SIZE`` students, with rounded figures, and nothing at all
until that many students consent. No transcript, item text or individual result
is read or returned.
"""

import uuid
from collections import defaultdict
from itertools import batched

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.classes.models import ClassMemberModel
from asterism.domains.classes.service import owned_class
from asterism.domains.study.insights import LEARNER_BATCH, learners_scores_by_cited_file
from asterism.domains.study.mastery import NEEDS_WORK_SCORE

from .models import CourseCopyItemModel, CourseCopyModel, CourseItemType

MIN_GROUP_SIZE = 5


class InsightTopic(BaseModel):
    name: str = Field(description="The course file the practice cited")
    students: int = Field(description="Consenting students who practiced it")
    average_score: float = Field(description="Mean of students' scores, rounded to the nearest 0.1")
    needs_work_share: float = Field(description="Share of those students below 0.5, rounded to the nearest 0.1")


class ClassInsights(BaseModel):
    min_group_size: int
    consenting_students: int
    topics: list[InsightTopic] = Field(description="Weakest first; only topics with enough students")
    hidden_topics: int = Field(description="Topics with too few students to show")


def _round(value: float) -> float:
    return round(round(value * 10) / 10, 1)


async def _consenting_members(class_id: uuid.UUID, session: AsyncSession) -> int:
    count = await session.scalar(
        select(func.count())
        .select_from(ClassMemberModel)
        .where(
            ClassMemberModel.class_id == class_id,
            ClassMemberModel.removed_at.is_(None),
            ClassMemberModel.insights_consent.is_(True),
        )
    )
    return count or 0


async def _consenting_copies(class_id: uuid.UUID, session: AsyncSession) -> list[CourseCopyModel]:
    return list(
        await session.scalars(
            select(CourseCopyModel)
            .join(
                ClassMemberModel,
                (ClassMemberModel.class_id == CourseCopyModel.class_id)
                & (ClassMemberModel.user_id == CourseCopyModel.user_id),
            )
            .where(
                CourseCopyModel.class_id == class_id,
                CourseCopyModel.project_id.is_not(None),
                ClassMemberModel.removed_at.is_(None),
                ClassMemberModel.insights_consent.is_(True),
            )
        )
    )


async def _students_topic_scores(class_id: uuid.UUID, copies: list[CourseCopyModel], session: AsyncSession):
    """Each consenting student's score per course file name, in a fixed number of queries. Stays inside this module."""
    names: dict[str, dict[uuid.UUID, str]] = defaultdict(dict)
    for students in batched(sorted({copy.user_id for copy in copies}), LEARNER_BATCH):
        for row in await session.scalars(
            select(CourseCopyItemModel).where(
                CourseCopyItemModel.class_id == class_id,
                CourseCopyItemModel.user_id.in_(students),
                CourseCopyItemModel.item_type == CourseItemType.FILE,
            )
        ):
            names[row.user_id][row.record_id] = row.item_key
    learners = [(copy.user_id, copy.project_id) for copy in copies if copy.project_id is not None]
    scores = await learners_scores_by_cited_file(learners, session)
    # Practice citing the student's own files is not course data and is left out.
    return [
        {
            names[user_id][file_id]: score
            for file_id, score in scores.get((user_id, project_id), {}).items()
            if file_id in names[user_id]
        }
        for user_id, project_id in learners
    ]


async def class_insights(user_id: str, class_id: uuid.UUID, session: AsyncSession) -> ClassInsights:
    await owned_class(user_id, class_id, session)
    consenting = await _consenting_members(class_id, session)
    if consenting < MIN_GROUP_SIZE:
        return ClassInsights(min_group_size=MIN_GROUP_SIZE, consenting_students=consenting, topics=[], hidden_topics=0)
    copies = await _consenting_copies(class_id, session)
    per_topic: dict[str, list[float]] = defaultdict(list)
    for student in await _students_topic_scores(class_id, copies, session):
        for name, score in student.items():
            per_topic[name].append(score)
    shown = [
        InsightTopic(
            name=name,
            students=len(scores),
            average_score=_round(sum(scores) / len(scores)),
            needs_work_share=_round(sum(score < NEEDS_WORK_SCORE for score in scores) / len(scores)),
        )
        for name, scores in per_topic.items()
        if len(scores) >= MIN_GROUP_SIZE
    ]
    shown.sort(key=lambda topic: (topic.average_score, topic.name.casefold()))
    return ClassInsights(
        min_group_size=MIN_GROUP_SIZE,
        consenting_students=consenting,
        topics=shown,
        hidden_topics=len(per_topic) - len(shown),
    )
