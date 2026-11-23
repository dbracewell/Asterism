"""The agent proposes a memory; only the person saves it (US-93.4, ADR-0078).

A proposal is a branch-aware chat record anchored to the run that made it: at
most one per run, and deleted with its chat. Nothing reaches ``memories`` until
the person saves it, and saving rechecks ownership and memory availability
live. Each proposal and decision adds an audit event with ids and times only.
Logs name ids, never text: a memory may be sensitive.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException
from asterism.db.mixins import get_unix_timestamp

from .models import (
    MemoryCategory,
    MemoryKind,
    MemoryModel,
    MemoryProposalAction,
    MemoryProposalEventModel,
    MemoryProposalModel,
    MemoryProposalStatus,
    MemorySavedBy,
)
from .policy import chat_memory_available
from .queries import select_owned_proposals
from .schemas import Memory, MemoryProposal, MemoryProposalSave, clean_memory_text
from .service import add_memory, to_memory, write_vector

logger = get_logger("Memory")


@dataclass(frozen=True)
class ProposalRun:
    """The recorded main-agent run that proposes, from its server-side execution scope."""

    user_id: str
    chat_id: uuid.UUID
    message_id: uuid.UUID
    execution_id: uuid.UUID
    agent_id: uuid.UUID


def to_proposal(row: MemoryProposalModel) -> MemoryProposal:
    return MemoryProposal(
        id=row.id,
        chat_id=row.chat_id,
        message_id=row.message_id,
        execution_id=row.execution_id,
        kind=row.kind,
        project_id=row.project_id,
        text=row.text,
        category=row.category,
        sensitive=row.sensitive,
        status=row.status,
        memory_id=row.memory_id,
        created_at=row.created_at,
        decided_at=row.decided_at,
    )


def _same_text(left: str, right: str) -> bool:
    return " ".join(left.split()).casefold() == " ".join(right.split()).casefold()


def _audit(row: MemoryProposalModel, action: MemoryProposalAction, session: AsyncSession) -> None:
    session.add(
        MemoryProposalEventModel(
            user_id=row.user_id,
            proposal_id=row.id,
            chat_id=row.chat_id,
            execution_id=row.execution_id,
            agent_id=row.agent_id,
            memory_id=row.memory_id,
            action=action,
        )
    )


async def _chat(user_id: str, chat_id: uuid.UUID, session: AsyncSession):
    from asterism.domains.chat.models import ChatModel
    from asterism.domains.chat.queries import select_owned_chats

    return await session.scalar(select_owned_chats(user_id=user_id).where(ChatModel.id == chat_id))


async def propose_memory(
    run: ProposalRun,
    *,
    kind: MemoryKind,
    text: str,
    category: MemoryCategory | None,
    sensitive: bool,
    session: AsyncSession,
) -> MemoryProposal:
    """Record the run's one proposal. Refusals are BadDataException with a reason for the agent."""
    chat = await _chat(run.user_id, run.chat_id, session)
    if chat is None or chat.purpose != "conversation":
        raise BadDataException("Memory proposals are only available in your conversations")
    availability = await chat_memory_available(run.user_id, run.chat_id, session)
    if not availability.available:
        raise BadDataException(f"Memory is off: {availability.reason}")
    try:
        text = clean_memory_text(text)
    except ValueError as exc:
        raise BadDataException(str(exc)) from exc
    if kind == MemoryKind.USER:
        project_id = None
        if category is None:
            raise BadDataException("A memory about the person needs a category")
    else:
        project_id = chat.project_id
        category = None
        if project_id is None:
            raise BadDataException("This chat isn't in a project; propose a memory about the person or none")
    sensitive = sensitive or category == MemoryCategory.ACCESSIBILITY
    owned = select_owned_proposals(run.user_id).where(MemoryProposalModel.chat_id == run.chat_id)
    if await session.scalar(owned.where(MemoryProposalModel.execution_id == run.execution_id)) is not None:
        raise BadDataException("You can propose only one memory per turn")
    dismissed = await session.scalars(owned.where(MemoryProposalModel.status == MemoryProposalStatus.DISMISSED))
    if any(_same_text(row.text, text) for row in dismissed):
        raise BadDataException("The person dismissed this memory in this chat; don't propose it again")
    row = MemoryProposalModel(
        user_id=run.user_id,
        chat_id=run.chat_id,
        message_id=run.message_id,
        execution_id=run.execution_id,
        agent_id=run.agent_id,
        kind=kind,
        project_id=project_id,
        text=text,
        category=category,
        sensitive=sensitive,
    )
    session.add(row)
    await session.flush()
    _audit(row, MemoryProposalAction.PROPOSED, session)
    await session.commit()
    logger.info(f"Run {run.execution_id} proposed {kind.value} memory {row.id} for user {run.user_id}")
    return to_proposal(row)


async def require_proposal(user_id: str, proposal_id: uuid.UUID, session: AsyncSession) -> MemoryProposalModel:
    row = await session.scalar(select_owned_proposals(user_id).where(MemoryProposalModel.id == proposal_id))
    if row is None:
        raise NotFoundException("Memory proposal not found")
    return row


async def read_proposal(user_id: str, proposal_id: uuid.UUID, session: AsyncSession) -> MemoryProposal:
    return to_proposal(await require_proposal(user_id, proposal_id, session))


async def _decide(
    row: MemoryProposalModel, status: MemoryProposalStatus, memory_id: uuid.UUID | None, session: AsyncSession
) -> None:
    """Move a pending proposal to its decision; a proposal decided elsewhere is a conflict."""
    result = await session.execute(
        update(MemoryProposalModel)
        .where(MemoryProposalModel.id == row.id, MemoryProposalModel.status == MemoryProposalStatus.PENDING)
        .values(status=status, memory_id=memory_id, decided_at=get_unix_timestamp())
        .returning(MemoryProposalModel.id)
        .execution_options(synchronize_session="fetch")
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        raise ConflictException("This proposal was already decided; reload the chat")


async def save_proposal(
    user_id: str, proposal_id: uuid.UUID, payload: MemoryProposalSave, session: AsyncSession
) -> Memory:
    """Save the proposal, as offered or edited, after checking the chat, project and switches live."""
    row = await require_proposal(user_id, proposal_id, session)
    if row.status != MemoryProposalStatus.PENDING:
        raise ConflictException("This proposal was already decided; reload the chat")
    chat = await _chat(user_id, row.chat_id, session)
    if chat is None:
        raise NotFoundException("Memory proposal not found")
    availability = await chat_memory_available(user_id, row.chat_id, session)
    if not availability.available:
        raise BadDataException(availability.reason)
    if row.kind == MemoryKind.PROJECT and chat.project_id != row.project_id:
        raise BadDataException("This chat is no longer in the project the memory was for")
    if row.kind == MemoryKind.USER and payload.category is None:
        raise BadDataException("A user memory needs a category")
    if row.kind == MemoryKind.PROJECT and payload.category is not None:
        raise BadDataException("A project memory has no category")
    memory = MemoryModel(
        user_id=user_id,
        kind=row.kind,
        project_id=row.project_id,
        text=payload.text,
        category=payload.category,
        sensitive=payload.sensitive,
        saved_by=MemorySavedBy.AGENT,
        source_chat_id=row.chat_id,
        source_message_id=row.message_id,
        source_execution_id=row.execution_id,
    )
    await add_memory(memory, session)
    await _decide(row, MemoryProposalStatus.SAVED, memory.id, session)
    await session.refresh(row)
    _audit(row, MemoryProposalAction.SAVED, session)
    await session.commit()
    await session.refresh(memory)
    logger.info(f"Saved proposal {row.id} as {row.kind.value} memory {memory.id} for user {user_id}")
    await write_vector(memory)
    return to_memory(memory)


async def dismiss_proposal(user_id: str, proposal_id: uuid.UUID, session: AsyncSession) -> MemoryProposal:
    row = await require_proposal(user_id, proposal_id, session)
    await _decide(row, MemoryProposalStatus.DISMISSED, None, session)
    await session.refresh(row)
    _audit(row, MemoryProposalAction.DISMISSED, session)
    await session.commit()
    logger.info(f"Dismissed memory proposal {row.id} for user {user_id}")
    return to_proposal(row)


async def proposal_events(user_id: str, session: AsyncSession) -> list[MemoryProposalEventModel]:
    """The owner's audit events, oldest first."""
    return list(
        await session.scalars(
            select(MemoryProposalEventModel)
            .where(MemoryProposalEventModel.user_id == user_id)
            .order_by(MemoryProposalEventModel.created_at, MemoryProposalEventModel.id)
        )
    )
