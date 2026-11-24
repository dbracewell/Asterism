"""Which of a person's rows go into their archive, and how a row becomes JSON.

The list is an allowlist. Left out on purpose: credentials (ChatGPT plan
connections and authorizations, providers), idempotency and draft bookkeeping
(send receipts, composer drafts), derived knowledge (artifacts and vectors, which
are rebuilt from the files) and agent traces. Chats, messages, canvases,
memories and settings are written by the archive builder in their own shapes.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from pydantic_core import to_jsonable_python
from sqlalchemy import LargeBinary, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.chat.compaction_models import ChatCompactionModel
from asterism.domains.classes.models import ClassMemberModel, EducatorRequestModel
from asterism.domains.courses.models import CourseCopyModel
from asterism.domains.files.models import UserFileModel
from asterism.domains.image_generation.models import ImageGenerationModel
from asterism.domains.memory.models import MemoryProposalEventModel, MemoryProposalModel, MessageMemoryModel
from asterism.domains.projects.models import ProjectFileModel, ProjectModel, ProjectSubAgentModel
from asterism.domains.prompt_templates.models import PromptTemplateModel
from asterism.domains.reflections.models import ReflectionModel
from asterism.domains.skills.models import AgentSkillModel, SkillModel
from asterism.domains.study.models import (
    StudyCardModel,
    StudyDeckModel,
    StudyNoteModel,
    StudyProposalModel,
    StudyQuizAnswerModel,
    StudyQuizAttemptModel,
    StudyQuizModel,
    StudyQuizQuestionModel,
    StudyReviewLogModel,
)
from asterism.domains.usage.models import UsageRecordModel
from asterism.domains.user.models import AccountDeletionRequestModel


@dataclass(frozen=True)
class RecordTable:
    """One table, written to ``records/<name>.json``; ``omit`` drops caches and binary blobs."""

    name: str
    model: Any
    omit: frozenset[str] = frozenset()


RECORD_TABLES: tuple[RecordTable, ...] = (
    RecordTable("projects", ProjectModel),
    RecordTable("project_files", ProjectFileModel),
    RecordTable("project_sub_agents", ProjectSubAgentModel),
    RecordTable("files", UserFileModel, frozenset({"content_cache", "thumbnail", "storage_key"})),
    RecordTable("skills", SkillModel),
    RecordTable("skill_assignments", AgentSkillModel),
    RecordTable("prompt_templates", PromptTemplateModel),
    RecordTable("study_decks", StudyDeckModel),
    RecordTable("study_cards", StudyCardModel),
    RecordTable("study_review_logs", StudyReviewLogModel),
    RecordTable("study_quizzes", StudyQuizModel),
    RecordTable("study_quiz_questions", StudyQuizQuestionModel),
    RecordTable("study_quiz_attempts", StudyQuizAttemptModel),
    RecordTable("study_quiz_answers", StudyQuizAnswerModel),
    RecordTable("study_notes", StudyNoteModel),
    RecordTable("study_proposals", StudyProposalModel),
    RecordTable("reflections", ReflectionModel),
    RecordTable("chat_compactions", ChatCompactionModel),
    RecordTable("image_generations", ImageGenerationModel),
    RecordTable("memory_proposals", MemoryProposalModel),
    RecordTable("memory_proposal_events", MemoryProposalEventModel),
    RecordTable("message_memories", MessageMemoryModel),
    RecordTable("usage_records", UsageRecordModel),
    RecordTable("class_memberships", ClassMemberModel),
    RecordTable("educator_requests", EducatorRequestModel),
    RecordTable("course_copies", CourseCopyModel),
    RecordTable("deletion_requests", AccountDeletionRequestModel),
)


def row_json(row: Any, omit: frozenset[str] = frozenset()) -> dict[str, Any]:
    """Every column of an ORM row as JSON-ready values, except ``omit`` and binary columns."""
    mapper = inspect(type(row))
    values: dict[str, Any] = {}
    for attribute in mapper.column_attrs:
        column = attribute.columns[0]
        if attribute.key in omit or isinstance(column.type, LargeBinary):
            continue
        values[attribute.key] = to_jsonable_python(getattr(row, attribute.key), fallback=str)
    return values


def select_owned(table: RecordTable, user_id: str):
    """The person's rows of ``table``, in primary-key order so archives are stable."""
    model = table.model
    return select(model).where(model.user_id == user_id).order_by(*inspect(model).primary_key)


async def owned_rows(table: RecordTable, user_id: str, session: AsyncSession) -> AsyncIterator[dict[str, Any]]:
    """Stream the person's rows of ``table`` as JSON-ready dicts, a page at a time."""
    result = await session.stream_scalars(select_owned(table, user_id).execution_options(yield_per=500))
    async for row in result:
        yield row_json(row, table.omit)
