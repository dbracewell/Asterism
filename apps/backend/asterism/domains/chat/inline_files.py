"""Save-time resolution of ``asterism-file:`` references in Markdown (ADR-0039 §2–4).

The text is scanned with the token's UUID pattern, not a Markdown parser. That
may also resolve a token inside a code span; the superset is safe because
resolution only ever confirms files the saving execution may already see.

A reference resolves when the file is in the chat's live file scope and also
either inside the run's recorded file ceiling or produced in this run. The main
agent may reference anything its run produced; a sub-agent only what it
produced. Everything else is stored as the same bare unavailable entry.
"""

import re
import uuid
from collections.abc import Iterable, Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.files.models import UserFileModel
from asterism.domains.files.queries import select_owned_files, select_produced_files

from .schemas import DelegationRecord, InlineFileReference, Message, MessageExecution
from .scope import resolve_chat_file_scope

MAX_INLINE_FILES = 32
"""Distinct file IDs resolved per saved text; later IDs are stored as unavailable."""

_TOKEN = re.compile(r"asterism-file:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")


def parse_file_references(text: str) -> list[uuid.UUID]:
    """Distinct referenced file IDs in order of first occurrence."""
    seen: dict[uuid.UUID, None] = {}
    for match in _TOKEN.finditer(text):
        seen.setdefault(uuid.UUID(match.group(1)), None)
    return list(seen)


async def resolve_inline_files(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    text: str,
    execution: MessageExecution | None,
    sub_agent_id: uuid.UUID | None,
    session: AsyncSession,
    live_file_ids: frozenset[uuid.UUID] | None = None,
) -> list[InlineFileReference]:
    """Resolve the references in one saved text.

    Args:
        user_id: Owner of the chat.
        chat_id: Chat the text is saved in.
        text: Assistant step content or sub-agent output.
        execution: The run that produced the text; without one nothing resolves.
        sub_agent_id: The sub-agent whose output this is, or ``None`` for the
            main agent.
        session: Active session.
        live_file_ids: Pre-read live chat scope, to share one read per save.

    Returns:
        One entry per distinct referenced ID, in order of first occurrence.
    """
    ids = parse_file_references(text)
    if not ids:
        return []
    candidates = ids[:MAX_INLINE_FILES]
    resolved: dict[uuid.UUID, InlineFileReference] = {}
    if execution is not None and execution.context is not None:
        if live_file_ids is None:
            live_file_ids = await read_live_file_ids(user_id=user_id, chat_id=chat_id, session=session)
        produced_query = select_produced_files(user_id=user_id, chat_id=chat_id, run_ids=[execution.id]).where(
            UserFileModel.id.in_(candidates)
        )
        if sub_agent_id is not None:
            produced_query = produced_query.where(UserFileModel.produced_agent_id == sub_agent_id)
        produced = {file.id: file for file in await session.scalars(produced_query)}
        ceiling = set(execution.context.allowed_file_ids)
        eligible = [
            file_id
            for file_id in candidates
            if file_id in live_file_ids and (file_id in ceiling or file_id in produced)
        ]
        referenced = {
            file.id: file
            for file in await session.scalars(
                select_owned_files(user_id=user_id).where(UserFileModel.id.in_(set(eligible) - set(produced)))
            )
        }
        for file_id in eligible:
            file = produced.get(file_id) or referenced.get(file_id)
            if file is None:
                continue
            resolved[file_id] = InlineFileReference(
                file_id=file_id,
                available=True,
                role="produced" if file_id in produced else "referenced",
                producing_execution_id=execution.id if file_id in produced else None,
                name=file.original_name,
                mime_type=file.mime_type,
                kind=file.kind,
                size=file.size,
            )
    return [resolved.get(file_id) or InlineFileReference(file_id=file_id, available=False) for file_id in ids]


async def read_live_file_ids(*, user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> frozenset[uuid.UUID]:
    scope = await resolve_chat_file_scope(user_id=user_id, chat_id=chat_id, session=session)
    return frozenset(scope.allowed_file_ids)


async def resolve_step(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    content: str,
    delegations: Sequence[DelegationRecord] | None,
    execution: MessageExecution | None,
    session: AsyncSession,
) -> tuple[list[InlineFileReference], list[DelegationRecord] | None]:
    """Resolve an assistant step's content and each delegation's output."""
    texts = [content, *(record.output for record in delegations or ())]
    if not any(parse_file_references(text) for text in texts):
        return [], [*delegations] if delegations is not None else None
    live = await read_live_file_ids(user_id=user_id, chat_id=chat_id, session=session)

    async def resolve(text: str, sub_agent_id: uuid.UUID | None) -> list[InlineFileReference]:
        return await resolve_inline_files(
            user_id=user_id,
            chat_id=chat_id,
            text=text,
            execution=execution,
            sub_agent_id=sub_agent_id,
            session=session,
            live_file_ids=live,
        )

    own = await resolve(content, None)
    if delegations is None:
        return own, None
    return own, [
        record.model_copy(update={"inline_files": await resolve(record.output, record.sub_agent_id)})
        for record in delegations
    ]


def with_live_availability(
    references: Iterable[InlineFileReference], allowed: frozenset[uuid.UUID] | set[uuid.UUID]
) -> list[InlineFileReference]:
    """Mark saved references unavailable once they leave the live chat scope.

    Saved display hints stay (the user already saw them); bytes still require
    the scoped routes, so a stale flag can never reach a revoked file.
    """
    return [
        reference
        if not reference.available or reference.file_id in allowed
        else reference.model_copy(update={"available": False})
        for reference in references
    ]


def apply_live_availability(messages: Iterable[Message], allowed: frozenset[uuid.UUID] | set[uuid.UUID]) -> None:
    """Recheck every inline reference of returned messages and their delegations."""
    for message in messages:
        message.inline_files = with_live_availability(message.inline_files, allowed)
        for record in message.delegations or ():
            record.inline_files = with_live_availability(record.inline_files, allowed)
