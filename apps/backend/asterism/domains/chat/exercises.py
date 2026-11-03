"""Spot-the-error exercises (US-55.4, ADR-0043).

In the Spot the error mode the model ends its answer with a fenced
``asterism-exercise`` block recording its one deliberate error. The block is
cut from streamed text and from the saved answer, and kept privately on the
message. The learner checks selections against it without a model call, and
can reveal the error, its correction and the source that disproves it.
"""

import json
import re
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, CodedException, NotFoundException
from asterism.domains.agent.learning_inputs import LearningModeId
from asterism.domains.llm.schemas import ToolResult
from asterism.domains.retrieval.citations import CITATION_KEY_LENGTH

from .exercise_schemas import (
    MAX_ATTEMPTS,
    AttemptResult,
    ExerciseAttempt,
    ExerciseAttemptRequest,
    ExerciseRecord,
    ExerciseView,
    exercise_view,
)
from .models import MessageModel
from .queries import select_owned_messages
from .schemas import DelegationRecord, MessageExecution
from .span_citations import resolve_citations, run_hits

MARKER = "```asterism-exercise"
_KEY = re.compile(rf"asterism-cite:([0-9a-f]{{{CITATION_KEY_LENGTH}}})")
_CITATION = re.compile(r"\[([^\]\n]*)\]\(asterism-cite:[0-9a-f]{12}(?:,[0-9a-f]{12}){0,3}\)")
_FILE = re.compile(r"!?\[([^\]\n]*)\]\(asterism-file:[0-9a-f-]{36}\)")
_MARKDOWN = re.compile(r"[*_`#>~]|\[|\]")

HISTORY_NOTE = "\n\n[This was a spot-the-error exercise answer. It contains one deliberate error; do not rely on it.]"

FEEDBACK: dict[AttemptResult, str] = {
    "found": "You found it. Reveal the answer to see the correction and the source.",
    "too_broad": "The error is in your selection, but it is too broad. Narrow it down.",
    "not_it": "That is not the deliberate error. Try another part.",
}


def is_exercise_run(execution: MessageExecution | None) -> bool:
    return execution is not None and execution.learning_mode.id == LearningModeId.SPOT_THE_ERROR


def streamed_text(content: str) -> str:
    """What may be shown while the reply streams: nothing from the record on.

    A trailing partial marker is held back too, so the block never flashes.
    """
    index = content.find(MARKER)
    if index >= 0:
        return content[:index].rstrip()
    for length in range(len(MARKER) - 1, 0, -1):
        if content.endswith(MARKER[:length]):
            return content[:-length]
    return content


@dataclass(frozen=True)
class RecordedError:
    quote: str
    correction: str | None
    source_key: str | None


def split_record(content: str) -> tuple[str, RecordedError | None]:
    """The visible answer and the recorded error, if the block is readable."""
    index = content.find(MARKER)
    if index < 0:
        return content, None
    visible = content[:index].rstrip()
    body = content[index + len(MARKER) :]
    end = body.find("```")
    body = body[:end] if end >= 0 else body
    start, stop = body.find("{"), body.rfind("}")
    try:
        data = json.loads(body[start : stop + 1]) if 0 <= start < stop else None
    except json.JSONDecodeError:
        data = None
    if not isinstance(data, dict):
        return visible, None
    quote = _text(data.get("quote"), 1_000)
    if quote is None:
        return visible, None
    source = data.get("source")
    key = _KEY.search(source) if isinstance(source, str) else None
    return visible, RecordedError(
        quote=quote, correction=_text(data.get("correction"), 1_000), source_key=key.group(1) if key else None
    )


def _text(value: object, max_chars: int) -> str | None:
    if not isinstance(value, str):
        return None
    value = " ".join(value.split())
    return value[:max_chars] if value else None


def normalize(text: str) -> str:
    """Comparable text: tokens as their labels, no Markdown marks, collapsed whitespace, casefolded."""
    text = _FILE.sub(lambda m: m.group(1), _CITATION.sub(lambda m: m.group(1), text))
    return " ".join(_MARKDOWN.sub("", text).split()).casefold()


async def build_record(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    content: str,
    tool_results: Sequence[ToolResult] | None,
    delegations: Sequence[DelegationRecord] | None,
    execution: MessageExecution | None,
    session: AsyncSession,
) -> tuple[str, ExerciseRecord]:
    """The answer without its record, and the stored record for it.

    A quote must occur in the visible answer. The source resolves only to a
    chunk this run retrieved from a file still in scope, like a claim citation.
    """
    visible, recorded = split_record(content)
    if recorded is None or normalize(recorded.quote) not in normalize(visible):
        return visible, ExerciseRecord(valid=False)
    source = None
    if recorded.source_key is not None:
        hits = await run_hits(
            user_id=user_id,
            chat_id=chat_id,
            tool_results=tool_results,
            delegations=delegations,
            execution=execution,
            session=session,
        )
        (source,) = await resolve_citations(
            user_id=user_id,
            text=f"asterism-cite:{recorded.source_key}",
            hits=hits,
            execution=execution,
            live_file_ids=await _live(user_id=user_id, chat_id=chat_id, session=session),
            session=session,
        )
    return visible, ExerciseRecord(valid=True, quote=recorded.quote, correction=recorded.correction, source=source)


async def _live(*, user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> frozenset[uuid.UUID]:
    from .inline_files import read_live_file_ids

    return await read_live_file_ids(user_id=user_id, chat_id=chat_id, session=session)


def grade(answer: str, quote: str, selection: str) -> AttemptResult | None:
    """Compare a selection with the recorded error by position in the answer.

    Returns None when the selection is not text from the answer. A selection
    inside the error, or one that covers most of it without much else, finds
    it; one that contains the error among a lot of other text is too broad.
    """
    text, wanted, chosen = normalize(answer), normalize(quote), normalize(selection)
    start = text.find(wanted)
    if not chosen or start < 0:
        return None
    end = start + len(wanted)
    occurrences = [match.start() for match in re.finditer(re.escape(chosen), text)]
    if not occurrences:
        return None
    best: AttemptResult = "not_it"
    for begin in occurrences:
        overlap = min(end, begin + len(chosen)) - max(start, begin)
        if overlap <= 0:
            continue
        if len(chosen) > max(2 * len(wanted), len(wanted) + 40):
            best = "too_broad"
        elif overlap >= 0.8 * len(chosen) or overlap >= 0.5 * len(wanted):
            return "found"
    return best


async def _require_exercise(
    *, user_id: str, chat_id: uuid.UUID, message_id: uuid.UUID, session: AsyncSession
) -> tuple[MessageModel, ExerciseRecord]:
    row = await session.scalar(
        select_owned_messages(user_id=user_id, chat_id=chat_id).where(MessageModel.id == message_id).with_for_update()
    )
    if row is None:
        raise NotFoundException("Message not found")
    if row.exercise_record is None:
        raise BadDataException("This message is not an exercise")
    return row, row.exercise_record


async def record_attempt(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    request: ExerciseAttemptRequest,
    session: AsyncSession,
) -> ExerciseView:
    row, record = await _require_exercise(user_id=user_id, chat_id=chat_id, message_id=message_id, session=session)
    if not record.valid or record.quote is None:
        raise CodedException(409, "This exercise has no recorded error to find")
    if record.revealed_at is not None:
        raise CodedException(409, "The answer has been revealed")
    if len(record.attempts) >= MAX_ATTEMPTS:
        raise CodedException(409, "No attempts left; reveal the answer")
    result = grade(row.content, record.quote, request.selection)
    if result is None:
        raise BadDataException("Select text from the answer")
    attempt = ExerciseAttempt(selection=" ".join(request.selection.split()), result=result, at=_now())
    row.exercise_record = record.model_copy(
        update={"attempts": [*record.attempts, attempt], "found": record.found or result == "found"}
    )
    await session.commit()
    return exercise_view(row.exercise_record)  # type: ignore[return-value]


async def reveal(*, user_id: str, chat_id: uuid.UUID, message_id: uuid.UUID, session: AsyncSession) -> ExerciseView:
    row, record = await _require_exercise(user_id=user_id, chat_id=chat_id, message_id=message_id, session=session)
    if record.revealed_at is None:
        row.exercise_record = record.model_copy(update={"revealed_at": _now()})
        await session.commit()
    view = exercise_view(row.exercise_record)
    assert view is not None
    if view.source is not None and view.source.available:
        live = await _live(user_id=user_id, chat_id=chat_id, session=session)
        if view.source.file_id not in live:
            view.source = view.source.model_copy(update={"available": False})
    return view


def _now() -> int:
    return int(time.time() * 1000)
