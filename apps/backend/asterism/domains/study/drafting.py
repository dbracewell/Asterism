"""Shared mechanics for drafting study items from project files (ADR-0034, ADR-0035).

Card drafts and quiz questions follow one bounded pipeline: resolve the chosen
files against the live project scope, read each through the retrieval domain's
``SourceReader`` with a fair share of the input budget, spread the requested
item count over the readable files, and run one model call per file. A failed
read, model error, unreadable reply or timeout fails only that file. Source text
and model output are untrusted and never logged.
"""

import asyncio
import json
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException
from asterism.domains.projects.scope import project_member_files, read_project_context
from asterism.domains.retrieval.sources import SourceExcerpt, SourceReader, SourceUnavailable

from .schemas import MAX_DRAFT_FILES, MAX_EXCERPT_CHARS, StudyCitation

logger = get_logger("StudyDrafting")

CITATION_EXCERPT_CHARS = 300
TIME_LIMIT_MESSAGE = "Stopped at the time limit; try fewer files or items."
UNREADABLE_REPLY = "The model returned an unreadable reply."
_SOURCE_LABEL = re.compile(r"\[?S(\d{1,4})\]?", re.IGNORECASE)


class DraftFailed(Exception):
    """One file's drafting failed; ``str(error)`` is safe to show the owner."""


@dataclass
class FileWork[T]:
    """One requested file's progress through the pipeline."""

    file_id: uuid.UUID
    file_name: str | None
    excerpt: SourceExcerpt | None = None
    items: list[T] = field(default_factory=list)
    error: str | None = None

    @property
    def failure(self) -> str | None:
        """Why this file produced nothing, or None when it was used."""
        if self.items:
            return None
        # Readable, but more readable files than requested items left it without a share.
        return self.error or "Not needed for the requested number of items."


# --- Prompt helpers ---------------------------------------------------------


def numbered_sources(excerpt: SourceExcerpt) -> str:
    """The excerpt's chunks labelled ``[S1]``, ``[S2]``… for the model to cite."""
    return "\n\n".join(f"[S{index}]\n{chunk.content}" for index, chunk in enumerate(excerpt.chunks, start=1))


def json_object(raw: str) -> Any:
    """The outermost JSON object in a model reply, tolerating prose or fences around it."""
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        raise DraftFailed(UNREADABLE_REPLY)
    try:
        return json.loads(raw[start : end + 1])
    except json.JSONDecodeError as error:
        raise DraftFailed(UNREADABLE_REPLY) from error


def source_citation(excerpt: SourceExcerpt, label: Any, file_name: str | None) -> StudyCitation:
    """The cited chunk, or a file-only citation when the label is not one we sent."""
    match = _SOURCE_LABEL.fullmatch(label.strip()) if isinstance(label, str) else None
    index = int(match.group(1)) if match else None
    if index is not None and 1 <= index <= len(excerpt.chunks):
        chunk = excerpt.chunks[index - 1]
        return StudyCitation(
            file_id=excerpt.file_id,
            chunk_id=chunk.chunk_id,
            artifact_generation=chunk.artifact_generation,
            excerpt=chunk.content[: min(CITATION_EXCERPT_CHARS, MAX_EXCERPT_CHARS)].strip() or None,
            available=True,
            file_name=file_name,
        )
    return StudyCitation(file_id=excerpt.file_id, available=True, file_name=file_name)


def clean_text(value: Any, max_chars: int) -> str | None:
    """A stripped, non-empty string within ``max_chars``, or None."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if value and len(value) <= max_chars else None


# --- File selection ---------------------------------------------------------


async def resolve_files(
    *, user_id: str, project_id: uuid.UUID, file_ids: list[uuid.UUID] | None, session: AsyncSession
) -> list[tuple[uuid.UUID, str]]:
    """``(file_id, name)`` for the chosen files, or the whole project scope when ``file_ids`` is None.

    Explicit choices keep their order; whole-project requests run in file-name
    order. Every file must be a live project member (400 otherwise).
    """
    chosen = list(file_ids) if file_ids is not None else None
    if chosen is None:
        _, members = await read_project_context(user_id=user_id, project_id=project_id, session=session)
        if not members:
            raise BadDataException("This project has no files to draft from")
        if len(members) > MAX_DRAFT_FILES:
            raise BadDataException(
                f"This project has more than {MAX_DRAFT_FILES} files; choose up to {MAX_DRAFT_FILES}"
            )
        chosen = list(members)
    names = await project_member_files(user_id=user_id, project_id=project_id, file_ids=set(chosen), session=session)
    if set(chosen) - names.keys():
        raise BadDataException("Choose files that are in this project")
    if file_ids is None:
        chosen.sort(key=lambda file_id: (names[file_id], str(file_id)))
    return [(file_id, names[file_id]) for file_id in chosen]


def allocate(count: int, files: int) -> list[int]:
    """Spread ``count`` items across ``files`` as evenly as possible (earlier files first)."""
    base, extra = divmod(count, files)
    return [base + (1 if index < extra else 0) for index in range(files)]


# --- Pipeline ---------------------------------------------------------------


async def run_until(deadline: float, tasks: list[asyncio.Task[None]]) -> None:
    """Wait for ``tasks`` until ``deadline``; cancel whatever is still running."""
    if not tasks:
        return
    _, pending = await asyncio.wait(tasks, timeout=max(0.0, deadline - time.monotonic()))
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)


async def _read(work: FileWork[Any], reader: SourceReader, max_chars: int) -> None:
    try:
        work.excerpt = await reader.read_file(work.file_id, max_chars=max_chars)
    except SourceUnavailable as error:
        work.error = str(error)
    except asyncio.CancelledError:
        work.error = TIME_LIMIT_MESSAGE
        raise


async def _produce[T](
    work: FileWork[T],
    share: int,
    produce: Callable[[SourceExcerpt, int, str | None], Awaitable[list[T]]],
    timeout: float,
    slots: asyncio.Semaphore,
    failure: str,
) -> None:
    assert work.excerpt is not None
    try:
        async with slots:
            work.items = await asyncio.wait_for(produce(work.excerpt, share, work.file_name), timeout=timeout)
    except DraftFailed as error:
        work.error = str(error)
    except TimeoutError:
        work.error = "The model took too long for this file."
    except asyncio.CancelledError:
        work.error = TIME_LIMIT_MESSAGE
        raise
    except Exception as error:
        logger.warning("Draft model failed file_id=%s error=%s", work.file_id, type(error).__name__)
        work.error = failure


async def draft_from_files[T](
    *,
    files: list[tuple[uuid.UUID, str]],
    reader: SourceReader,
    count: int,
    produce: Callable[[SourceExcerpt, int, str | None], Awaitable[list[T]]],
    max_input_chars: int,
    model_call_seconds: float,
    deadline: float,
    max_concurrent_calls: int,
    failure: str,
) -> list[FileWork[T]]:
    """Read every file, then ``produce`` each readable file's share of ``count`` items.

    ``produce(excerpt, share, file_name)`` makes one model call and parses its
    reply, raising ``DraftFailed`` with an owner-safe reason when it cannot.
    ``failure`` is the reason shown for any other model error.
    """
    works: list[FileWork[T]] = [FileWork(file_id, name) for file_id, name in files]
    budget = max_input_chars // len(works)
    await run_until(deadline, [asyncio.create_task(_read(work, reader, budget)) for work in works])

    readable = [work for work in works if work.excerpt is not None]
    slots = asyncio.Semaphore(max_concurrent_calls)
    shares = allocate(count, len(readable)) if readable else []
    await run_until(
        deadline,
        [
            asyncio.create_task(_produce(work, share, produce, model_call_seconds, slots, failure))
            for work, share in zip(readable, shares, strict=True)
            if share > 0
        ],
    )
    return works
