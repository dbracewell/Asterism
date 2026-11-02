"""Fork a recorded run from a delegation step (US-54.5); see ADR-0038.

Accepting a fork adds a pending sibling of the source step under the same parent
and makes it active. It keeps the step's model output, the results of every call
except the forked top-level delegation, and those calls' delegation records
(marked reused). The step gets a copy of the source run's execution record
with the fork's run-only sub-agent instructions. Running it takes the ordinary
resume path, so the fork replays the recorded inputs with live rechecks. The
original branch and the sub-agent definition are never modified.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import CodedException, NotFoundException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.context_manifest import ContextManifest
from asterism.domains.agent.instruction_overrides import InstructionOverride, ReplayedStep, override_for
from asterism.domains.agent.service import get_agent_profile
from asterism.domains.llm.schemas import ToolResult

from .branches import active_branch
from .comparisons import pending_on_branch
from .draft_models import ChatSendReceiptModel
from .execution_models import ChatExecutionModel
from .inline_files import resolve_step
from .jobs import chat_jobs
from .models import ChatModel, MessageModel
from .queries import select_owned_chats, select_owned_executions, select_owned_messages
from .schemas import (
    DelegationRecord,
    ForkInstructions,
    ForkProvenance,
    Message,
    MessageExecution,
    MessageForkRequest,
    MessageStatus,
)
from .span_citations import resolve_step_citations

# ---------------------------------------------------------------------------
# Record traversal
# ---------------------------------------------------------------------------


def _delegation(source: MessageModel, execution_id: uuid.UUID) -> DelegationRecord:
    record = next((item for item in source.delegations or [] if item.execution_id == execution_id), None)
    if record is None:
        raise NotFoundException("Delegation not found")
    return record


def top_level_delegation(records: Sequence[DelegationRecord], record: DelegationRecord) -> DelegationRecord:
    """The depth-0 delegation containing ``record``; a fork re-runs it from its call."""
    by_id = {item.execution_id: item for item in records}
    current = record
    for _ in range(len(records) + 1):
        if current.parent_execution_id is None:
            return current
        parent = by_id.get(current.parent_execution_id)
        if parent is None:
            break
        current = parent
    raise CodedException(409, "This delegation's record is incomplete and can't be forked")


def subtree_ids(records: Sequence[DelegationRecord], root: DelegationRecord) -> set[uuid.UUID]:
    """``root`` and every delegation run beneath it."""
    ids = {root.execution_id}
    changed = True
    while changed:
        changed = False
        for item in records:
            if item.parent_execution_id in ids and item.execution_id not in ids:
                ids.add(item.execution_id)
                changed = True
    return ids


def step_index(source: MessageModel, execution: MessageExecution, by_id: dict[uuid.UUID, MessageModel]) -> int:
    """Zero-based index of ``source`` among its run's steps.

    A run's steps follow its request message: the user turn, the assistant
    step a regeneration started from (which is not part of the run), or a
    fork's own replayed step (which is, at its recorded index).
    """
    count = 0
    current: MessageModel | None = source
    while current is not None and current.id != execution.request_message_id:
        if current.role != "assistant":
            raise CodedException(409, "This step's run record is incomplete and can't be forked")
        count += 1
        current = by_id.get(current.parent_message_id) if current.parent_message_id else None
    if current is None:
        raise CodedException(409, "This step's run record is incomplete and can't be forked")
    if execution.fork is not None:
        return execution.fork.step_index + count
    return count - 1


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def _source_step(
    *, user_id: str, chat_id: uuid.UUID, message_id: uuid.UUID, session: AsyncSession
) -> tuple[MessageModel, ChatExecutionModel]:
    source = await session.scalar(
        select_owned_messages(user_id=user_id, chat_id=chat_id)
        .where(MessageModel.id == message_id)
        .execution_options(populate_existing=True)
    )
    if source is None or source.role != "assistant" or source.execution_id is None:
        raise NotFoundException("Message not found")
    record = await session.scalar(
        select_owned_executions(user_id=user_id, chat_id=chat_id).where(ChatExecutionModel.id == source.execution_id)
    )
    if record is None:
        raise NotFoundException("Message not found")
    return source, record


async def read_fork_instructions(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    delegation_execution_id: uuid.UUID,
    session: AsyncSession,
) -> ForkInstructions:
    """The instructions the fork dialog starts from; owner only.

    A run that was itself a fork starts from its own override for that
    sub-agent. Otherwise it's the definition's current instructions, because
    sub-agent layer text isn't stored.
    """
    source, record = await _source_step(user_id=user_id, chat_id=chat_id, message_id=message_id, session=session)
    delegation = _delegation(source, delegation_execution_id)
    rerun = top_level_delegation(source.delegations or [], delegation)
    try:
        definition = await get_agent_profile(user_id, delegation.sub_agent_id, session)
    except Exception as error:
        raise NotFoundException("Sub-agent not found") from error
    if not definition.sub_agent:
        raise NotFoundException("Sub-agent not found")
    override = override_for(record.instruction_overrides, delegation.sub_agent_id)
    return ForkInstructions(
        sub_agent_id=delegation.sub_agent_id,
        sub_agent_name=definition.name,
        instructions=override.instructions if override else definition.system_prompt or "",
        source="fork" if override else "definition",
        definition_revision=definition.config_revision,
        rerun_execution_id=rerun.execution_id,
        rerun_sub_agent_name=rerun.name,
    )


# ---------------------------------------------------------------------------
# Acceptance
# ---------------------------------------------------------------------------


def _fingerprint(chat_id: uuid.UUID, message_id: uuid.UUID, payload: MessageForkRequest) -> str:
    body = payload.model_dump_json(exclude={"request_id"})
    return hashlib.sha256(f"fork:{chat_id}:{message_id}:{body}".encode()).hexdigest()


async def _lock_chat(*, user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> ChatModel:
    chat = await session.scalar(
        update(ChatModel)
        .where(ChatModel.id == chat_id, ChatModel.user_id == user_id)
        .values(updated_at=ChatModel.updated_at)
        .returning(ChatModel)
        .execution_options(populate_existing=True),
    )
    if chat is None:
        raise NotFoundException("Chat not found")
    return chat


def _forked_execution(
    source: MessageExecution,
    *,
    step_id: uuid.UUID,
    fork: ForkProvenance,
) -> MessageExecution:
    """The source run's execution, re-keyed to the fork step, with fork provenance."""
    execution_id = uuid.uuid4()
    context = (
        source.context.model_copy(update={"execution_id": execution_id, "request_message_id": step_id})
        if source.context is not None
        else None
    )
    return source.model_copy(
        update={"id": execution_id, "request_message_id": step_id, "context": context, "fork": fork},
        deep=True,
    )


async def accept_fork(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: MessageForkRequest,
    session: AsyncSession,
) -> Message:
    """Add a pending fork of step ``message_id`` beside it and make it active."""
    expected = _fingerprint(chat_id, message_id, payload)
    receipt = await session.get(ChatSendReceiptModel, (user_id, payload.request_id))
    if receipt is not None:
        if receipt.fingerprint != expected:
            raise CodedException(409, "Request ID was already used for a different request")
        accepted = await session.get(MessageModel, receipt.message_id)
        if accepted is None:
            raise NotFoundException("Accepted fork not found")
        return Message.model_validate(accepted)
    if not await session.scalar(
        select_owned_chats(user_id=user_id).with_only_columns(ChatModel.id).where(ChatModel.id == chat_id),
    ):
        raise NotFoundException("Chat not found")
    with chat_jobs.guard_idle_change(chat_id):
        try:
            chat = await _lock_chat(user_id=user_id, chat_id=chat_id, session=session)
            source, source_record = await _source_step(
                user_id=user_id, chat_id=chat_id, message_id=message_id, session=session
            )
            records = list(
                await session.scalars(
                    select_owned_messages(user_id=user_id, chat_id=chat_id).execution_options(populate_existing=True)
                )
            )
            by_id = {record.id: record for record in records}
            branch = active_branch(records, chat.active_root_id)
            if source.id not in {message.id for message in branch}:
                raise CodedException(409, "Chat branch changed; reload before forking")
            if branch[-1].status == MessageStatus.PENDING or pending_on_branch(records, branch):
                raise CodedException(409, "A message is awaiting generation; resume or regenerate it")
            if source.status != MessageStatus.COMPLETED or source.parent_message_id is None:
                raise CodedException(409, "Only a completed step can be forked")

            delegations = source.delegations or []
            delegation = _delegation(source, payload.delegation_execution_id)
            rerun = top_level_delegation(delegations, delegation)
            call = next((item for item in source.tool_calls or [] if item.id == rerun.tool_call_id), None)
            if rerun.tool_call_id is None or call is None:
                raise CodedException(409, "This delegation's record is incomplete and can't be forked")

            try:
                definition = await get_agent_profile(user_id, delegation.sub_agent_id, session)
            except Exception as error:
                raise CodedException(409, "This sub-agent no longer exists") from error
            if not definition.sub_agent:
                raise CodedException(409, "This sub-agent no longer exists")

            source_execution = source_record.execution
            override = InstructionOverride(
                sub_agent_id=delegation.sub_agent_id,
                base_revision=definition.config_revision,
                instructions=payload.instructions,
            )
            overrides = [
                *(item for item in source_record.instruction_overrides if item.sub_agent_id != override.sub_agent_id),
                override,
            ]

            rerun_ids = subtree_ids(delegations, rerun)
            step = MessageModel(
                id=uuid.uuid4(),
                user_id=user_id,
                chat_id=chat_id,
                parent_message_id=source.parent_message_id,
                role="assistant",
                status=MessageStatus.PENDING,
                content=source.content,
                thinking=source.thinking,
                model_id=source.model_id,
                tool_calls=source.tool_calls,
                tool_call_results=[
                    result for result in source.tool_call_results or [] if result and result.tool_call.id != call.id
                ],
                delegations=[
                    item.model_copy(update={"reused": True})
                    for item in delegations
                    if item.execution_id not in rerun_ids
                ]
                or None,
            )
            session.add(step)
            await session.flush()
            execution = _forked_execution(
                source_execution,
                step_id=step.id,
                fork=ForkProvenance(
                    source_message_id=source.id,
                    source_execution_id=source_execution.id,
                    delegation_execution_id=delegation.execution_id,
                    sub_agent_id=delegation.sub_agent_id,
                    step_index=step_index(source, source_execution, by_id),
                    overrides=[item.provenance for item in overrides],
                ),
            )
            session.add(
                ChatExecutionModel(
                    id=execution.id,
                    user_id=user_id,
                    chat_id=chat_id,
                    request_message_id=step.id,
                    execution=execution,
                    prompt=source_record.prompt.model_copy(deep=True),
                    instruction_overrides=overrides,
                )
            )
            await session.flush()
            step.execution_id = execution.id
            step.pending_execution_id = execution.id
            await session.execute(
                update(MessageModel)
                .where(
                    MessageModel.id == source.parent_message_id,
                    MessageModel.chat_id == chat_id,
                    MessageModel.user_id == user_id,
                )
                .values(active_child_id=step.id),
            )
            session.add(
                ChatSendReceiptModel(
                    user_id=user_id,
                    request_id=payload.request_id,
                    chat_id=chat_id,
                    message_id=step.id,
                    fingerprint=expected,
                ),
            )
            await session.flush()
            await session.refresh(step, ["execution_record", "pending_execution_record"])
            result = Message.model_validate(step)
            await session.commit()
            return result
        except BaseException:
            await session.rollback()
            raise


# ---------------------------------------------------------------------------
# Runtime (the chat's own running job only)
# ---------------------------------------------------------------------------


def replayed_step(step: Message, execution: MessageExecution) -> ReplayedStep:
    """The recorded step a pending fork starts from."""
    if execution.fork is None:
        raise CodedException(409, "This step is not a fork")
    return ReplayedStep(
        content=step.content,
        thinking=step.thinking,
        tool_calls=list(step.tool_calls or []),
        reused_results={result.tool_call.id: result for result in step.tool_call_results or [] if result},
        step_index=execution.fork.step_index,
    )


async def write_fork_step(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    status: MessageStatus,
    tool_call_results: Sequence[ToolResult] | None,
    delegations: list[DelegationRecord] | None,
    context: ContextManifest | None,
) -> Message:
    """Record a fork step's results once it has run (or been cancelled)."""
    async with get_async_db_session() as session:
        await _lock_chat(user_id=user_id, chat_id=chat_id, session=session)
        message = await session.scalar(
            select_owned_messages(user_id=user_id, chat_id=chat_id).where(MessageModel.id == message_id)
        )
        if message is None:
            raise NotFoundException("Message not found")
        message.status = status
        message.tool_call_results = [*tool_call_results] if tool_call_results is not None else []
        # A fork resolves its references again against live access (ADR-0039 §4).
        message.inline_files, message.delegations = await resolve_step(
            user_id=user_id,
            chat_id=chat_id,
            content=message.content,
            delegations=delegations,
            execution=message.execution,
            session=session,
        )
        message.citations, message.delegations = await resolve_step_citations(
            user_id=user_id,
            chat_id=chat_id,
            content=message.content,
            tool_results=message.tool_call_results,
            delegations=message.delegations,
            execution=message.execution,
            session=session,
        )
        message.context = context
        await session.flush()
        result = Message.model_validate(message)
        await session.commit()
        return result
