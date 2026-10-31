"""Side-by-side comparison columns (US-54.4); see ADR-0027.

A comparison is two or three sibling user turns under the same parent that
share a ``comparison_id``. Each column runs on its own fixed target model and
may carry its own prompt; otherwise every column has the same accepted inputs.
Columns are ordinary chat branches: the parent's active child (or the chat's
active root) selects which one the conversation continues from. They run one
after another in the chat's single work slot, so admission limits are unchanged.
"""

from __future__ import annotations

import hashlib
import uuid
from collections.abc import Sequence

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, CodedException, NotFoundException
from asterism.domains.chatgpt.availability import ModelAvailability
from asterism.domains.settings.models import LLMModel
from asterism.domains.settings.queries import select_visible_models

from .branches import active_branch, sibling_order
from .draft_models import ChatSendReceiptModel
from .jobs import chat_jobs
from .model_selection import model_choice, require_chat_model
from .models import ChatModel, MessageModel
from .queries import select_owned_chats, select_owned_messages
from .schemas import (
    ChatComparison,
    ChatModelChoice,
    ComparisonActivate,
    ComparisonColumn,
    ComparisonTarget,
    Message,
    MessageCompareRequest,
    MessageStatus,
)


async def resolve_targets(
    *,
    user_id: str,
    targets: Sequence[ComparisonTarget],
    default_prompt: str,
    has_skills: bool,
    session: AsyncSession,
    taken: Sequence[tuple[uuid.UUID, str]] = (),
) -> list[tuple[ChatModelChoice, str, str | None]]:
    """Each target's available model and effective prompt; columns must differ."""
    seen = set(taken)
    resolved = []
    for target in targets:
        prompt = target.user_prompt if target.user_prompt is not None else default_prompt
        if not prompt.strip() and not has_skills:
            raise BadDataException("Every comparison column needs a prompt")
        key = (target.model_id, prompt)
        if key in seen:
            raise BadDataException("Comparison columns must differ in model or prompt")
        seen.add(key)
        label = " ".join(target.label.split()) if target.label else None
        resolved.append((await require_chat_model(target.model_id, user_id, session), prompt, label or None))
    return resolved


def column_models(
    *,
    template_prompt: str,
    resolved: Sequence[tuple[ChatModelChoice, str, str | None]],
    comparison_id: uuid.UUID,
    first_index: int,
    **inputs,
) -> list[MessageModel]:
    """Pending user turns for each column; a template label only applies to its own prompt."""
    template = inputs.pop("accepted_template", None)
    return [
        MessageModel(
            **inputs,
            role="user",
            status=MessageStatus.PENDING,
            content=prompt,
            accepted_template=template if prompt == template_prompt else None,
            comparison_id=comparison_id,
            comparison_index=first_index + offset,
            target_model_id=choice.id,
            comparison_label=label,
        )
        for offset, (choice, prompt, label) in enumerate(resolved)
    ]


async def make_active(*, chat: ChatModel, column: MessageModel, session: AsyncSession) -> None:
    """Continue the conversation from ``column``; roots use the chat's active-root pointer."""
    if column.parent_message_id is None:
        chat.active_root_id = column.id
        await session.flush()
        return
    await session.execute(
        update(MessageModel)
        .where(
            MessageModel.id == column.parent_message_id,
            MessageModel.chat_id == chat.id,
            MessageModel.user_id == chat.user_id,
        )
        .values(active_child_id=column.id),
    )


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


async def _records(*, user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> list[MessageModel]:
    return list(
        await session.scalars(
            select_owned_messages(user_id=user_id, chat_id=chat_id).execution_options(populate_existing=True),
        ),
    )


def pending_on_branch(records: Sequence[MessageModel], branch: Sequence[Message]) -> list[MessageModel]:
    """Unanswered columns of every comparison the active branch passes through, in run order."""
    comparisons = {message.comparison_id for message in branch if message.comparison_id is not None}
    return sorted(
        (
            record
            for record in records
            if record.comparison_id in comparisons and record.status == MessageStatus.PENDING
        ),
        key=sibling_order,
    )


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def _replies(column: MessageModel, by_id: dict[uuid.UUID, MessageModel]) -> list[Message]:
    """The assistant steps answering a column: its active chain until the next user turn."""
    replies: list[Message] = []
    current = by_id.get(column.active_child_id) if column.active_child_id else None
    while current is not None and current.role == "assistant" and len(replies) < len(by_id):
        replies.append(Message.model_validate(current))
        current = by_id.get(current.active_child_id) if current.active_child_id else None
    return replies


def _status(column: MessageModel, replies: list[Message]) -> str:
    if column.status == MessageStatus.PENDING or (replies and replies[-1].status == MessageStatus.PENDING):
        return "pending"
    if column.status == MessageStatus.CANCELLED or (replies and replies[-1].status == MessageStatus.CANCELLED):
        return "cancelled"
    return "completed" if replies else "pending"


async def _comparison(
    *,
    chat: ChatModel,
    comparison_id: uuid.UUID,
    records: list[MessageModel],
    session: AsyncSession,
) -> ChatComparison:
    columns = sorted(
        (record for record in records if record.comparison_id == comparison_id),
        key=lambda record: record.comparison_index or 0,
    )
    if not columns:
        raise NotFoundException("Comparison not found")
    by_id = {record.id: record for record in records}
    on_branch = {message.id for message in active_branch(records, chat.active_root_id)}
    availability = await ModelAvailability.load(chat.user_id, session)
    target_ids = [column.target_model_id for column in columns]
    models = {
        row.id: model_choice(row, availability)
        for row in await session.scalars(select_visible_models(chat.user_id).where(LLMModel.id.in_(target_ids)))
    }
    result = []
    for column in columns:
        replies = _replies(column, by_id)
        result.append(
            ComparisonColumn(
                index=column.comparison_index or 0,
                request=Message.model_validate(column),
                replies=replies,
                model=models.get(column.target_model_id) if column.target_model_id else None,
                status=_status(column, replies),  # type: ignore[arg-type]
                input_tokens=sum(reply.input_tokens for reply in replies),
                output_tokens=sum(reply.output_tokens for reply in replies),
                total_tokens=sum(reply.total_tokens for reply in replies),
                generation_duration_ms=sum(reply.generation_duration_ms for reply in replies),
            ),
        )
    active = next((column.comparison_index for column in columns if column.id in on_branch), None)
    return ChatComparison(
        id=comparison_id,
        chat_id=chat.id,
        parent_message_id=columns[0].parent_message_id,
        active_index=active,
        columns=result,
    )


async def read_comparison(
    *, user_id: str, chat_id: uuid.UUID, comparison_id: uuid.UUID, session: AsyncSession
) -> ChatComparison:
    chat = await session.scalar(select_owned_chats(user_id=user_id).where(ChatModel.id == chat_id))
    if chat is None:
        raise NotFoundException("Chat not found")
    records = await _records(user_id=user_id, chat_id=chat_id, session=session)
    return await _comparison(chat=chat, comparison_id=comparison_id, records=records, session=session)


# ---------------------------------------------------------------------------
# Changes
# ---------------------------------------------------------------------------


async def activate_column(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    comparison_id: uuid.UUID,
    payload: ComparisonActivate,
    session: AsyncSession,
) -> ChatComparison:
    """Continue from one column; the other columns stay as sibling branches."""
    if not await session.scalar(
        select_owned_chats(user_id=user_id).with_only_columns(ChatModel.id).where(ChatModel.id == chat_id),
    ):
        raise NotFoundException("Chat not found")
    with chat_jobs.guard_idle_change(chat_id):
        try:
            chat = await _lock_chat(user_id=user_id, chat_id=chat_id, session=session)
            column = await session.scalar(
                select_owned_messages(user_id=user_id, chat_id=chat_id).where(
                    MessageModel.comparison_id == comparison_id,
                    MessageModel.comparison_index == payload.index,
                ),
            )
            if column is None:
                raise NotFoundException("Comparison column not found")
            await make_active(chat=chat, column=column, session=session)
            await session.flush()
            records = await _records(user_id=user_id, chat_id=chat_id, session=session)
            result = await _comparison(chat=chat, comparison_id=comparison_id, records=records, session=session)
            await session.commit()
            return result
        except BaseException:
            await session.rollback()
            raise


def _fingerprint(chat_id: uuid.UUID, message_id: uuid.UUID, payload: MessageCompareRequest) -> str:
    body = payload.model_dump_json(exclude={"request_id"})
    return hashlib.sha256(f"compare:{chat_id}:{message_id}:{body}".encode()).hexdigest()


async def compare_existing(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: MessageCompareRequest,
    session: AsyncSession,
) -> ChatComparison:
    """Turn an answered user turn into column 0 and add a pending column per target.

    New columns rerun the turn's accepted inputs (files, skills, persona and
    template) exactly; only the model, and optionally the prompt, differ. The
    original turn stays active, so the conversation is unchanged until the
    user chooses another column.
    """
    expected = _fingerprint(chat_id, message_id, payload)
    receipt = await session.get(ChatSendReceiptModel, (user_id, payload.request_id))
    if receipt is not None:
        if receipt.fingerprint != expected:
            raise CodedException(409, "Request ID was already used for a different send")
        source = await session.get(MessageModel, receipt.message_id)
        if source is None or source.comparison_id is None:
            raise NotFoundException("Accepted comparison not found")
        return await read_comparison(
            user_id=user_id, chat_id=chat_id, comparison_id=source.comparison_id, session=session
        )
    if not await session.scalar(
        select_owned_chats(user_id=user_id).with_only_columns(ChatModel.id).where(ChatModel.id == chat_id),
    ):
        raise NotFoundException("Chat not found")
    with chat_jobs.guard_idle_change(chat_id):
        try:
            chat = await _lock_chat(user_id=user_id, chat_id=chat_id, session=session)
            records = await _records(user_id=user_id, chat_id=chat_id, session=session)
            by_id = {record.id: record for record in records}
            source = by_id.get(message_id)
            if source is None or source.role != "user":
                raise NotFoundException("Message not found")
            branch = active_branch(records, chat.active_root_id)
            if message_id not in {message.id for message in branch}:
                raise CodedException(409, "Chat branch changed; reload before comparing")
            if source.comparison_id is not None:
                raise CodedException(409, "This turn is already part of a comparison")
            if branch[-1].status == MessageStatus.PENDING or pending_on_branch(records, branch):
                raise CodedException(409, "A message is awaiting generation; resume or regenerate it")
            reply = by_id.get(source.active_child_id) if source.active_child_id else None
            executed = reply.execution if reply is not None else None
            if executed is None or reply is None or reply.status != MessageStatus.COMPLETED:
                raise CodedException(409, "Answer this message before comparing it")
            resolved = await resolve_targets(
                user_id=user_id,
                targets=payload.targets,
                default_prompt=source.content,
                has_skills=bool(source.accepted_skills.snapshots),
                session=session,
                taken=[(executed.model.id, source.content)],
            )
            comparison_id = uuid.uuid4()
            source.comparison_id = comparison_id
            source.comparison_index = 0
            source.target_model_id = executed.model.id
            columns = column_models(
                template_prompt=source.content,
                resolved=resolved,
                comparison_id=comparison_id,
                first_index=1,
                user_id=user_id,
                chat_id=chat_id,
                parent_message_id=source.parent_message_id,
                files=source.files,
                accepted_skills=source.accepted_skills,
                accepted_persona=source.accepted_persona,
                accepted_template=source.accepted_template,
            )
            session.add_all(columns)
            session.add(
                ChatSendReceiptModel(
                    user_id=user_id,
                    request_id=payload.request_id,
                    chat_id=chat_id,
                    message_id=source.id,
                    fingerprint=expected,
                ),
            )
            await session.flush()
            records = await _records(user_id=user_id, chat_id=chat_id, session=session)
            result = await _comparison(chat=chat, comparison_id=comparison_id, records=records, session=session)
            await session.commit()
            return result
        except BaseException:
            await session.rollback()
            raise


def assert_no_pending_columns(*, records: Sequence[MessageModel], branch: Sequence[Message]) -> None:
    if pending_on_branch(records, branch):
        raise CodedException(409, "Comparison answers are still pending; resume them first")
