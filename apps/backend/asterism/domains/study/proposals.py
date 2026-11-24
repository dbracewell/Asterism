"""Recording chat drafts of decks and quizzes (EPIC-98, ADR-0080).

The tools call ``record_proposal`` from a recorded main-agent run. It checks,
live, that drafting is available in the chat, that the run has no draft of this
kind yet, and that every cited file is in the run's file scope and the project.
Refusals are BadDataException with a reason the assistant can act on. Nothing is
saved to Study here; the person saves or dismisses the draft.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException

from .chat_policy import chat_study_available
from .models import StudyProposalModel
from .proposal_schemas import StudyDeckDraft, StudyProposal, StudyQuizDraft


@dataclass(frozen=True)
class ProposalRun:
    """The recorded main-agent run that drafts, from its server-side execution scope."""

    user_id: str
    chat_id: uuid.UUID
    project_id: uuid.UUID
    message_id: uuid.UUID
    execution_id: uuid.UUID
    allowed_file_ids: frozenset[uuid.UUID]


def cited_files(draft: StudyDeckDraft | StudyQuizDraft) -> set[uuid.UUID]:
    items = draft.cards if isinstance(draft, StudyDeckDraft) else draft.questions
    return {file_id for item in items for file_id in item.file_ids}


def to_proposal(row: StudyProposalModel) -> StudyProposal:
    deck = StudyDeckDraft.model_validate(row.payload) if row.kind == "deck" else None
    quiz = StudyQuizDraft.model_validate(row.payload) if row.kind == "quiz" else None
    return StudyProposal.model_validate(
        {
            "id": row.id,
            "project_id": row.project_id,
            "chat_id": row.chat_id,
            "message_id": row.message_id,
            "kind": row.kind,
            "status": row.status,
            "deck": deck,
            "quiz": quiz,
            "saved_id": row.saved_id,
            "created_at": row.created_at,
            "decided_at": row.decided_at,
        }
    )


async def record_proposal(
    run: ProposalRun, draft: StudyDeckDraft | StudyQuizDraft, session: AsyncSession
) -> StudyProposal:
    """Store the run's one draft of this kind."""
    from asterism.domains.projects.scope import project_member_files

    available, reason = await chat_study_available(run.user_id, run.chat_id, session)
    if not available:
        raise BadDataException(reason)
    kind = "deck" if isinstance(draft, StudyDeckDraft) else "quiz"
    existing = await session.scalar(
        select(StudyProposalModel.id).where(
            StudyProposalModel.user_id == run.user_id,
            StudyProposalModel.execution_id == run.execution_id,
            StudyProposalModel.kind == kind,
        )
    )
    if existing is not None:
        raise BadDataException(f"You can draft only one {kind} per turn")
    cited = cited_files(draft)
    if cited - run.allowed_file_ids:
        raise BadDataException("Cite only files this chat can use")
    members = await project_member_files(
        user_id=run.user_id, project_id=run.project_id, file_ids=cited, session=session
    )
    if cited - members.keys():
        raise BadDataException("Cite only files in this project")
    row = StudyProposalModel(
        user_id=run.user_id,
        project_id=run.project_id,
        chat_id=run.chat_id,
        message_id=run.message_id,
        execution_id=run.execution_id,
        kind=kind,
        payload=draft.model_dump(mode="json"),
    )
    session.add(row)
    await session.commit()
    return to_proposal(row)
