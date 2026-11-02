"""Internal registration of files produced by tools during a chat run (US-56.2).

This is not an HTTP route and not a model-facing tool: only server-side tool
code can call it, with the server-derived :class:`ExecutionScope` of the run.
The model controls at most the suggested name and the bytes a tool produced.

Rules (ADR-0039 §6):

- The file is an ordinary ``user_files`` row owned by the run's user, with
  ``origin = agent`` and provenance (chat, run, agent, tool).
- Its type is detected from content. The suggested name is sanitized,
  de-duplicated, and its extension is replaced when it does not match.
- Per-run limits cap the number and total size of produced files; a rejected
  registration stores nothing.
- The file joins the chat through a ``chat_files`` membership. Branch scope then
  admits it only while a message of the producing run is on the active branch.
"""

import asyncio
import hashlib
import mimetypes
import re
import uuid
import weakref
from dataclasses import dataclass
from pathlib import Path

import filetype
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.images import generate_thumbnail
from asterism.core import config
from asterism.core.exceptions import BadDataException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.execution_scope import ExecutionScope
from asterism.domains.knowledge.artifacts import ensure_artifact, start_ingestion

from .models import FileContentStatus, FileKind, FileOrigin, UserFileModel
from .service import _deduplicated_filename, classify_file, sanitize_filename
from .store import get_file_store

FILE_REFERENCE_SCHEME = "asterism-file:"
"""Destination prefix of an inline file reference (ADR-0039 §1)."""

_TEXT_MIME_TYPES = {
    "application/json",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "application/toml",
    "application/sql",
}
"""Non-``text/*`` types a UTF-8 file may keep from its suggested name."""

_SVG = re.compile(
    rb"\A(?:\xef\xbb\xbf)?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--.*?-->\s*)*(?:<!doctype\s+svg[^>]*>\s*)?<svg[\s>/]",
    re.IGNORECASE | re.DOTALL,
)

_run_locks: weakref.WeakValueDictionary[uuid.UUID, asyncio.Lock] = weakref.WeakValueDictionary()
"""Serializes limit checks per run. Entries vanish when no registration holds them."""


class ProducedFileRejected(BadDataException):
    """A produced file was refused: limit, type or context. Nothing was stored."""


@dataclass(frozen=True)
class ProducedFile:
    """A registered produced file, as reported back to the tool.

    Attributes:
        file_id: Identifier of the new ``user_files`` row.
        filename: De-duplicated display name in the user's library.
        mime_type: Content-detected MIME type.
        kind: Classification driving conversion and display.
        size: Size in bytes.
    """

    file_id: uuid.UUID
    filename: str
    mime_type: str
    kind: FileKind
    size: int

    @property
    def token(self) -> str:
        """The opaque reference token, ``asterism-file:<uuid>``."""
        return file_reference_token(self.file_id)

    @property
    def embed(self) -> str:
        """A ready-made Markdown embed for the reply."""
        label = re.sub(r"[\[\]\\\r\n]", "", self.filename)[:200]
        return f"![{label}]({self.token})"

    def tool_result(self) -> str:
        """Model-facing tool result text carrying the ready-to-use embed."""
        return (
            f'Saved file "{self.filename}" ({self.mime_type}, {self.size} bytes). '
            f"To show it in your reply, include exactly: {self.embed}"
        )


def file_reference_token(file_id: uuid.UUID) -> str:
    """Format the canonical lowercase reference token for a file id."""
    return f"{FILE_REFERENCE_SCHEME}{file_id}"


def detect_produced_type(name: str, content: bytes) -> tuple[str, str]:
    """Detect a produced file's MIME type from its bytes and fix its name.

    The suggested name never decides the type. A name may only refine a
    UTF-8 text file into a more specific text type (``.csv``, ``.md``, ``.json``).

    Args:
        name: Sanitized suggested display name.
        content: The produced bytes.

    Returns:
        The detected MIME type and the name with a matching extension.

    Raises:
        ProducedFileRejected: If the content is binary of an unknown type.
    """
    stem, suffix = Path(name).stem or "file", Path(name).suffix.lower()
    guessed = mimetypes.guess_type(name)[0]
    kind = filetype.guess(content)
    if kind is not None:
        mime_type = str(kind.mime)
        if guessed == mime_type:
            return mime_type, name
        return mime_type, f"{stem}.{kind.extension}"
    if _SVG.match(content[:4096]):
        return "image/svg+xml", name if suffix == ".svg" else f"{stem}.svg"
    try:
        content.decode("utf-8")
    except UnicodeDecodeError:
        raise ProducedFileRejected("Produced file content type is not recognized") from None
    if b"\x00" in content:
        raise ProducedFileRejected("Produced file content type is not recognized")
    # SVG markup that failed the sniff must not keep an SVG name or type.
    if guessed and guessed != "image/svg+xml" and (guessed.startswith("text/") or guessed in _TEXT_MIME_TYPES):
        return guessed, name
    return "text/plain", f"{stem}.txt"


def _producer(scope: ExecutionScope) -> tuple[str, uuid.UUID, uuid.UUID, uuid.UUID]:
    if scope.execution_id is None:
        raise ProducedFileRejected("Files can only be produced inside a recorded chat run")
    return scope.user_id, scope.chat_id, scope.execution_id, scope.agent_id


async def register_produced_file(
    scope: ExecutionScope,
    *,
    tool: str,
    name: str,
    content: bytes,
) -> ProducedFile:
    """Store bytes a tool produced as a chat file with provenance.

    Args:
        scope: The calling execution's server-derived scope. Its user, chat,
            run and agent become the file's owner and provenance.
        tool: Name of the registering tool.
        name: Suggested display name; sanitized and corrected.
        content: The produced bytes.

    Returns:
        The registered file, including its reference token.

    Raises:
        ProducedFileRejected: For a limit, an unrecognized type, a malformed
            or denied name, or a run that does not belong to the chat.
    """
    user_id, chat_id, execution_id, agent_id = _producer(scope)
    tool = tool.strip()
    if not tool or len(tool) > 128:
        raise ProducedFileRejected("Producing tool name is invalid")
    if len(content) > config.max_upload_file_size_bytes:
        raise ProducedFileRejected(f"Produced file exceeds the {config.max_upload_file_size_bytes} byte limit")
    try:
        mime_type, name = detect_produced_type(sanitize_filename(name), content)
        name = sanitize_filename(name)  # The corrected extension is checked again.
    except ProducedFileRejected:
        raise
    except BadDataException as error:
        raise ProducedFileRejected(str(error)) from error
    kind = classify_file(name, mime_type)
    thumbnail = await asyncio.to_thread(generate_thumbnail, content) if kind is FileKind.IMAGE else None

    lock = _run_locks.get(execution_id)
    if lock is None:
        lock = _run_locks[execution_id] = asyncio.Lock()
    async with lock, get_async_db_session() as session:
        file, artifact = await _insert(
            session,
            user_id=user_id,
            chat_id=chat_id,
            execution_id=execution_id,
            agent_id=agent_id,
            tool=tool,
            name=name,
            mime_type=mime_type,
            kind=kind,
            content=content,
            thumbnail=thumbnail,
        )
    start_ingestion(user_id=user_id, file_id=file.id, artifact=artifact)
    return ProducedFile(file_id=file.id, filename=file.filename, mime_type=mime_type, kind=kind, size=len(content))


async def _check_run_limits(session: AsyncSession, *, user_id: str, execution_id: uuid.UUID, size: int) -> None:
    count, total = (
        await session.execute(
            select(func.count(UserFileModel.id), func.coalesce(func.sum(UserFileModel.size), 0)).where(
                UserFileModel.user_id == user_id,
                UserFileModel.produced_execution_id == execution_id,
            )
        )
    ).one()
    if count >= config.max_produced_files_per_run:
        raise ProducedFileRejected(f"This run already produced {config.max_produced_files_per_run} files")
    if total + size > config.max_produced_bytes_per_run:
        raise ProducedFileRejected(f"This run's produced files would exceed {config.max_produced_bytes_per_run} bytes")


async def _insert(
    session: AsyncSession,
    *,
    user_id: str,
    chat_id: uuid.UUID,
    execution_id: uuid.UUID,
    agent_id: uuid.UUID,
    tool: str,
    name: str,
    mime_type: str,
    kind: FileKind,
    content: bytes,
    thumbnail: str | None,
):
    from asterism.domains.chat.file_references import attach_produced_file

    store = get_file_store()
    storage_key: str | None = None
    try:
        await _check_run_limits(session, user_id=user_id, execution_id=execution_id, size=len(content))
        file_id = uuid.uuid4()
        storage_key = store.save(user_id, file_id, Path(name).suffix, content)
        file = UserFileModel(
            id=file_id,
            user_id=user_id,
            storage_key=storage_key,
            filename=await _deduplicated_filename(session, user_id, name),
            original_name=name,
            size=len(content),
            mime_type=mime_type,
            kind=kind,
            sha256=hashlib.sha256(content).hexdigest(),
            content_status=FileContentStatus.PENDING,
            thumbnail=thumbnail,
            origin=FileOrigin.AGENT,
            produced_chat_id=chat_id,
            produced_execution_id=execution_id,
            produced_agent_id=agent_id,
            produced_tool=tool,
        )
        session.add(file)
        await session.flush()
        try:
            await attach_produced_file(
                user_id=user_id, chat_id=chat_id, execution_id=execution_id, file_id=file_id, session=session
            )
        except BadDataException as error:
            raise ProducedFileRejected(str(error)) from error
        artifact = await ensure_artifact(file_id=file_id, user_id=user_id, session=session)
        await session.commit()
    except (Exception, asyncio.CancelledError):
        await session.rollback()
        if storage_key is not None:
            store.delete(user_id, storage_key)
        raise
    return file, artifact
