"""Recording chat drafts of decks and quizzes (EPIC-98, ADR-0080).

The tools call ``record_proposal`` from a recorded main-agent run. It checks,
live, that drafting is available in the chat, that the run has no draft of this
kind yet, and that every cited file is in the run's file scope and the project.
Refusals are BadDataException with a reason the assistant can act on. Nothing is
saved to Study here; the person saves or dismisses the draft.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException
from asterism.db.mixins import get_unix_timestamp

from .chat_policy import chat_study_available
from .models import StudyCardModel, StudyDeckModel, StudyProposalModel
from .proposal_schemas import StudyProposal, StudyProposalDeck, StudyProposalQuiz, StudyProposalSave
from .schemas import StudyCitationInput

logger = get_logger("StudyProposals")


@dataclass(frozen=True)
class ProposalRun:
    """The recorded main-agent run that drafts, from its server-side execution scope."""

    user_id: str
    chat_id: uuid.UUID
    project_id: uuid.UUID
    message_id: uuid.UUID
    execution_id: uuid.UUID
    allowed_file_ids: frozenset[uuid.UUID]


def cited_files(draft: StudyProposalDeck | StudyProposalQuiz) -> set[uuid.UUID]:
    items = draft.cards if isinstance(draft, StudyProposalDeck) else draft.questions
    return {file_id for item in items for file_id in item.file_ids}


def to_proposal(row: StudyProposalModel) -> StudyProposal:
    deck = StudyProposalDeck.model_validate(row.payload) if row.kind == "deck" else None
    quiz = StudyProposalQuiz.model_validate(row.payload) if row.kind == "quiz" else None
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
    run: ProposalRun, draft: StudyProposalDeck | StudyProposalQuiz, session: AsyncSession
) -> StudyProposal:
    """Store the run's one draft of this kind."""
    from asterism.domains.projects.scope import project_member_files

    available, reason = await chat_study_available(run.user_id, run.chat_id, session)
    if not available:
        raise BadDataException(reason)
    kind = "deck" if isinstance(draft, StudyProposalDeck) else "quiz"
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


async def require_proposal(user_id: str, proposal_id: uuid.UUID, session: AsyncSession) -> StudyProposalModel:
    row = await session.scalar(
        select(StudyProposalModel).where(StudyProposalModel.id == proposal_id, StudyProposalModel.user_id == user_id)
    )
    if row is None:
        raise NotFoundException("Draft not found")
    return row


async def read_proposal(user_id: str, proposal_id: uuid.UUID, session: AsyncSession) -> StudyProposal:
    return to_proposal(await require_proposal(user_id, proposal_id, session))


async def _decide(row: StudyProposalModel, status: str, saved_id: uuid.UUID | None, session: AsyncSession) -> None:
    """Move a pending draft to its decision; one decided elsewhere is a conflict, so a save never repeats."""
    result = await session.execute(
        update(StudyProposalModel)
        .where(StudyProposalModel.id == row.id, StudyProposalModel.status == "pending")
        .values(status=status, saved_id=saved_id, decided_at=get_unix_timestamp())
        .returning(StudyProposalModel.id)
        .execution_options(synchronize_session="fetch")
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        raise ConflictException("This draft was already saved or dismissed; reload the chat")


async def _chat_project(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> uuid.UUID | None:
    from asterism.domains.chat.models import ChatModel
    from asterism.domains.chat.queries import select_owned_chats

    return await session.scalar(
        select_owned_chats(user_id=user_id).with_only_columns(ChatModel.project_id).where(ChatModel.id == chat_id)
    )


async def _run_model(execution_id: uuid.UUID, session: AsyncSession) -> tuple[uuid.UUID | None, str]:
    """The model that drafted it, recorded on a saved quiz like a generated one's."""
    from asterism.domains.chat.execution_models import ChatExecutionModel

    run = await session.get(ChatExecutionModel, execution_id)
    if run is None:
        return None, "Chat assistant"
    model = run.execution.model
    return model.id, model.display_name or model.name


def _citations(file_ids: list[uuid.UUID]) -> list[StudyCitationInput]:
    return [StudyCitationInput(file_id=file_id) for file_id in file_ids]


async def save_proposal(
    user_id: str, proposal_id: uuid.UUID, payload: StudyProposalSave, session: AsyncSession
) -> StudyProposal:
    """Save the draft, as offered or edited, after checking the chat, project and switches live."""
    from .citations import serialize_citations
    from .quizzes import QuestionDraft, save_quiz

    row = await require_proposal(user_id, proposal_id, session)
    if row.status != "pending":
        raise ConflictException("This draft was already saved or dismissed; reload the chat")
    if await _chat_project(user_id, row.chat_id, session) != row.project_id:
        raise BadDataException("This chat is no longer in the project the draft was for")
    available, reason = await chat_study_available(user_id, row.chat_id, session)
    if not available:
        raise BadDataException(reason)
    saved_id = uuid.uuid4()
    if row.kind == "deck":
        if payload.deck is None or payload.quiz is not None:
            raise BadDataException("Save a deck draft as a deck")
        deck = payload.deck
        cards = [
            (
                card,
                await serialize_citations(
                    user_id=user_id, project_id=row.project_id, citations=_citations(card.file_ids), session=session
                ),
            )
            for card in deck.cards
        ]
        await _decide(row, "saved", saved_id, session)
        session.add(
            StudyDeckModel(
                id=saved_id,
                user_id=user_id,
                project_id=row.project_id,
                name=deck.title,
                description=deck.description,
                tags=[],
                proposal_id=row.id,
                source_chat_id=row.chat_id,
            )
        )
        await session.flush()
        session.add_all(
            StudyCardModel(user_id=user_id, deck_id=saved_id, front=card.front, back=card.back, citations=citations)
            for card, citations in cards
        )
        await session.commit()
    else:
        if payload.quiz is None or payload.deck is not None:
            raise BadDataException("Save a quiz draft as a quiz")
        quiz = payload.quiz
        cited = cited_files(quiz)
        await serialize_citations(
            user_id=user_id, project_id=row.project_id, citations=_citations(sorted(cited)), session=session
        )
        model_id, model_name = await _run_model(row.execution_id, session)
        await _decide(row, "saved", saved_id, session)
        await save_quiz(
            user_id=user_id,
            project_id=row.project_id,
            title=quiz.title,
            origin="chat",
            model_id=model_id,
            model_name=model_name,
            questions=[
                QuestionDraft(
                    kind=question.kind,
                    prompt=question.prompt,
                    options=list(question.options),
                    correct_option=question.correct_option,
                    rubric=question.rubric,
                    explanation=question.explanation,
                    citations=_citations(question.file_ids),
                )
                for question in quiz.questions
            ],
            session=session,
            quiz_id=saved_id,
            proposal_id=row.id,
            source_chat_id=row.chat_id,
        )
    await session.refresh(row)
    logger.info(f"Saved study draft {row.id} as {row.kind} {saved_id} for user {user_id}")
    return to_proposal(row)


async def dismiss_proposal(user_id: str, proposal_id: uuid.UUID, session: AsyncSession) -> StudyProposal:
    row = await require_proposal(user_id, proposal_id, session)
    await _decide(row, "dismissed", None, session)
    await session.commit()
    await session.refresh(row)
    logger.info(f"Dismissed study draft {row.id} for user {user_id}")
    return to_proposal(row)
