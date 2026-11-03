"""Save-time resolution of ``asterism-cite:`` claim citations (ADR-0040).

The text is scanned with the token pattern, not a Markdown parser, like file
references (ADR-0039 §2). A key resolves only to a chunk that the saving run
retrieved through ``search_knowledge``, from a file inside both the run's
recorded file ceiling and the chat's live file scope. The main agent may cite
chunks from any step of its run, including its sub-agents' retrievals; a
sub-agent may cite only its own. Everything else is stored as the same bare
unavailable entry, so a guessed key reveals nothing.
"""

import re
import uuid
from collections.abc import Iterable, Iterator, Sequence

from pydantic import TypeAdapter, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.files.models import UserFileModel
from asterism.domains.files.queries import select_owned_files
from asterism.domains.llm.schemas import ToolResult
from asterism.domains.retrieval.citations import CITATION_KEY_LENGTH, MAX_KEYS_PER_CITATION, citation_key
from asterism.domains.retrieval.service import RetrievalHit

from .citation_schemas import SpanCitation
from .inline_files import read_live_file_ids
from .models import MessageModel
from .queries import select_owned_messages
from .schemas import DelegationRecord, Message, MessageExecution

MAX_SPAN_CITATIONS = 64
"""Distinct keys resolved per saved text; later keys are stored as unavailable."""

MAX_CITATION_EXCERPT_CHARS = 1_000

_hits = TypeAdapter(list[RetrievalHit])

_KEY = f"[0-9a-f]{{{CITATION_KEY_LENGTH}}}"
_TOKEN = re.compile(rf"asterism-cite:({_KEY}(?:,{_KEY}){{0,{MAX_KEYS_PER_CITATION - 1}}})(?![0-9a-f,])")


def parse_citation_keys(text: str) -> list[str]:
    """Distinct cited keys in order of first occurrence."""
    seen: dict[str, None] = {}
    for match in _TOKEN.finditer(text):
        for key in match.group(1).split(","):
            seen.setdefault(key, None)
    return list(seen)


def retrieved_hits(tool_results: Iterable[ToolResult]) -> Iterator[RetrievalHit]:
    """Hits from recorded ``search_knowledge`` results; malformed results are skipped."""
    for result in tool_results:
        if result.tool_call.function.name != "search_knowledge" or not isinstance(result.raw_result, dict):
            continue
        try:
            yield from _hits.validate_python(result.raw_result.get("results", []))
        except ValidationError:
            continue


def _excerpt(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= MAX_CITATION_EXCERPT_CHARS else f"{text[: MAX_CITATION_EXCERPT_CHARS - 1]}…"


async def resolve_citations(
    *,
    user_id: str,
    text: str,
    hits: Iterable[RetrievalHit],
    execution: MessageExecution | None,
    live_file_ids: frozenset[uuid.UUID],
    session: AsyncSession,
) -> list[SpanCitation]:
    """Resolve the citations in one saved text against the hits it may cite.

    Args:
        user_id: Owner of the chat.
        text: Assistant step content or sub-agent output.
        hits: Chunks the saving execution retrieved.
        execution: The run that produced the text; without one nothing resolves.
        live_file_ids: The chat's live file scope.
        session: Active session.

    Returns:
        One entry per distinct cited key, in order of first occurrence.
    """
    keys = parse_citation_keys(text)
    if not keys:
        return []
    resolved: dict[str, SpanCitation] = {}
    if execution is not None and execution.context is not None:
        ceiling = set(execution.context.allowed_file_ids)
        wanted = set(keys[:MAX_SPAN_CITATIONS])
        by_key: dict[str, RetrievalHit] = {}
        for hit in hits:
            key = citation_key(hit.file_id, hit.chunk_id)
            if key in wanted and hit.file_id in ceiling and hit.file_id in live_file_ids:
                by_key.setdefault(key, hit)
        names = {
            file.id: file.original_name
            for file in await session.scalars(
                select_owned_files(user_id=user_id).where(
                    UserFileModel.id.in_({hit.file_id for hit in by_key.values()})
                )
            )
        }
        for key, hit in by_key.items():
            if hit.file_id not in names:
                continue
            resolved[key] = SpanCitation(
                key=key,
                available=True,
                file_id=hit.file_id,
                chunk_id=hit.chunk_id,
                artifact_generation=hit.artifact_generation,
                match_kind=hit.match_kind,
                name=names[hit.file_id],
                excerpt=_excerpt(hit.excerpt),
            )
    return [resolved.get(key) or SpanCitation(key=key, available=False) for key in keys]


async def _earlier_run_results(
    *, user_id: str, chat_id: uuid.UUID, execution_id: uuid.UUID, session: AsyncSession
) -> tuple[list[ToolResult], list[DelegationRecord]]:
    """Tool results and delegations of the run's steps saved before this one."""
    rows = await session.execute(
        select_owned_messages(user_id=user_id, chat_id=chat_id)
        .where(MessageModel.execution_id == execution_id)
        .with_only_columns(MessageModel.tool_call_results, MessageModel.delegations)
    )
    results: list[ToolResult] = []
    delegations: list[DelegationRecord] = []
    for tool_results, records in rows:
        results.extend(tool_results or ())
        delegations.extend(records or ())
    return results, delegations


async def resolve_step_citations(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    content: str,
    tool_results: Sequence[ToolResult] | None,
    delegations: Sequence[DelegationRecord] | None,
    execution: MessageExecution | None,
    session: AsyncSession,
) -> tuple[list[SpanCitation], list[DelegationRecord] | None]:
    """Resolve an assistant step's citations and each delegation's own.

    The step may cite anything retrieved in its run so far: earlier steps, this
    step and every delegation of either. A delegation cites only its own hits.
    """
    records = [*delegations] if delegations is not None else None
    if not any(parse_citation_keys(text) for text in [content, *(record.output for record in records or ())]):
        return [], records
    live = await read_live_file_ids(user_id=user_id, chat_id=chat_id, session=session)

    async def resolve(text: str, hits: Iterable[RetrievalHit]) -> list[SpanCitation]:
        return await resolve_citations(
            user_id=user_id, text=text, hits=hits, execution=execution, live_file_ids=live, session=session
        )

    own: list[SpanCitation] = []
    if parse_citation_keys(content):
        hits = await run_hits(
            user_id=user_id,
            chat_id=chat_id,
            tool_results=tool_results,
            delegations=records,
            execution=execution,
            session=session,
        )
        own = await resolve(content, hits)
    if records is None:
        return own, None
    return own, [
        record.model_copy(update={"citations": await resolve(record.output, retrieved_hits(record.tool_results))})
        for record in records
    ]


async def run_hits(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    tool_results: Sequence[ToolResult] | None,
    delegations: Sequence[DelegationRecord] | None,
    execution: MessageExecution | None,
    session: AsyncSession,
) -> list[RetrievalHit]:
    """Everything the run retrieved so far: earlier steps, this step and every delegation."""
    run_results: list[ToolResult] = [*(tool_results or ())]
    run_records: list[DelegationRecord] = [*(delegations or ())]
    if execution is not None:
        earlier_results, earlier_records = await _earlier_run_results(
            user_id=user_id, chat_id=chat_id, execution_id=execution.id, session=session
        )
        run_results += earlier_results
        run_records += earlier_records
    run_results += [result for record in run_records for result in record.tool_results]
    return list(retrieved_hits(run_results))


def with_live_citations(
    citations: Iterable[SpanCitation], allowed: frozenset[uuid.UUID] | set[uuid.UUID]
) -> list[SpanCitation]:
    """Mark saved citations unavailable once their file leaves the live chat scope.

    The snapshot stays (the user already saw it); opening the file still goes
    through the scoped routes.
    """
    return [
        citation
        if not citation.available or citation.file_id in allowed
        else citation.model_copy(update={"available": False})
        for citation in citations
    ]


def apply_live_citations(messages: Iterable[Message], allowed: frozenset[uuid.UUID] | set[uuid.UUID]) -> None:
    """Recheck every citation of returned messages and their delegations."""
    for message in messages:
        message.citations = with_live_citations(message.citations, allowed)
        for record in message.delegations or ():
            record.citations = with_live_citations(record.citations, allowed)
