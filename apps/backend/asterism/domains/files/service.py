"""File storage use cases: uploads, reading and downloading bytes, and deletes.

This module is the transactional boundary: it coordinates the database, the
file store, the content processor and the knowledge-ingestion runtime. Reads
and listings live in :mod:`.listing` and a file's knowledge processing in
:mod:`.knowledge_processing`; their public functions are re-exported here.
Two rules shape the code here:

- The database is authoritative. Bytes are written only after the row exists
  (or removed only after the row is gone), and the two are reconciled on
  failure so a half-completed upload never leaves an orphan source.
- Every lookup is scoped by ``user_id``; ownership is never taken from the
  request payload.
"""

import asyncio
import mimetypes
import re
import unicodedata
import uuid
from dataclasses import dataclass
from pathlib import Path

import filetype
from fastapi import UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.hashing import sha256_bytes
from asterism.common.images import generate_thumbnail
from asterism.common.log import get_logger
from asterism.core import config
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.db.database import get_async_db_session
from asterism.domains.courses.locks import require_not_course_managed
from asterism.domains.knowledge.artifacts import (
    ArtifactSummary,
    delete_file_vectors,
    ensure_artifact,
    remove_artifacts,
    start_ingestion,
)

from .knowledge_processing import (
    cancel_file_knowledge_processing,
    get_file_knowledge_status,
    get_similar_files,
    regenerate_file_knowledge,
)
from .listing import (
    _owned_file,
    describe_files,
    get_file_info_by_id,
    get_user_file_info,
    list_user_files,
    validate_owned_file_ids,
)
from .models import FileContentStatus, FileKind, UserFileModel
from .processor import ensure_file_processed as ensure_file_processed
from .queries import (
    select_file_by_content,
    select_file_id_by_name,
    select_files_by_ids,
    select_files_by_names,
)
from .schemas import UserFile, UserFileList
from .store import get_file_store as get_file_store
from .store import save_off_loop

logger = get_logger("FilesService")

SOURCE_RESPONSE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
}
"""Stored bytes are untrusted: never sniffed, and inert even if opened directly (ADR-0039 §7)."""

_DENIED_EXTENSIONS = {
    ".app",
    ".bat",
    ".bin",
    ".cmd",
    ".com",
    ".dll",
    ".dylib",
    ".exe",
    ".jar",
    ".msi",
    ".scr",
    ".so",
}
"""Executable/binary extensions that are never accepted, regardless of content."""

_IMAGE_MIME_TYPES = {
    "image/bmp",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
}
"""MIME types that are treated as images even without a matching extension."""

_TEXT_EXTENSIONS = {
    ".c",
    ".cpp",
    ".cs",
    ".css",
    ".go",
    ".h",
    ".ini",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".log",
    ".md",
    ".php",
    ".py",
    ".rb",
    ".rs",
    ".sh",
    ".sql",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}
"""Extensions whose sources can be read directly as UTF-8 text."""

_DOCUMENT_EXTENSIONS = {
    ".csv",
    ".docx",
    ".epub",
    ".htm",
    ".html",
    ".md",
    ".pdf",
    ".pptx",
    ".rst",
    ".xls",
    ".xlsx",
}
"""Extensions that need document-to-text conversion."""


async def get_user_file(
    user_id: str,
    filename: str,
    session: AsyncSession | None = None,
    if_none_match: str | None = None,
) -> Response:
    """Download the original bytes of one of the caller's files.

    Args:
        user_id: Owner of the file.
        filename: Display name of the file. It must not contain a path
            separator.
        session: Optional existing session to reuse; a new one is opened when
            omitted.
        if_none_match: Raw ``If-None-Match`` header value, used to answer
            conditional requests.

    Returns:
        A ``200`` file response, or a ``304`` when the client's validator
        already matches the stored content digest.

    Raises:
        BadDataException: If ``filename`` looks like a path.
        NotFoundException: If the file does not exist or its bytes are gone.
    """
    if not filename or Path(filename).name != filename or "/" in filename or "\\" in filename:
        raise BadDataException("Access to file is denied")
    async with get_async_db_session(session) as session:
        file = await _owned_file(user_id=user_id, filename=filename, session=session)
        store = get_file_store()
        if not await store.exists(user_id, file.storage_key):
            raise NotFoundException("Access to file is denied")
        # FileResponse streams from disk and serves Range requests.
        requested_path = store.local_path(user_id, file.storage_key)

        etag = f'"{file.sha256}"'
        headers = {
            "Cache-Control": "private, no-cache",
            "ETag": etag,
            **SOURCE_RESPONSE_HEADERS,
        }

        if if_none_match:
            client_tags = [tag.strip() for tag in if_none_match.split(",")]
            if etag in client_tags or file.sha256 in client_tags or "*" in client_tags:
                return Response(status_code=304, headers=headers)

        return FileResponse(
            path=requested_path,
            filename=file.original_name,
            media_type=file.mime_type,
            headers=headers,
        )


def sanitize_filename(name: str) -> str:
    """Reduce a client-supplied filename to a safe, displayable name.

    Strips any directory component, leading dots, and control, format and
    text-direction characters (Unicode categories Cc and Cf, such as U+202E,
    which can make ``evil.exe`` read as ``exe.live``), and rejects names that
    are empty, too long, or carry a denied extension.

    Args:
        name: Raw filename as sent by the client.

    Returns:
        The sanitized filename.

    Raises:
        BadDataException: If the name is malformed or carries a denied
            extension.
    """
    # US-116.2: invisible and direction-changing characters are dropped.
    name = "".join(character for character in name if unicodedata.category(character) not in {"Cc", "Cf"})
    if not name:
        raise BadDataException("Filename is malformed")
    # Browsers may send either path separator in upload names.
    filename = name.replace("\\", "/").rsplit("/", 1)[-1].strip()
    filename = re.sub(r"^\.+", "", filename)
    if not filename or filename in {".", ".."} or len(filename) > 255:
        raise BadDataException("Filename is malformed")
    if Path(filename).suffix.lower() in _DENIED_EXTENSIONS:
        raise BadDataException("This file extension is not allowed")
    return filename


def classify_file(filename: str, mime_type: str) -> FileKind:
    """Classify a file into the :class:`FileKind` that drives conversion.

    Args:
        filename: Sanitized display name of the file.
        mime_type: Detected MIME type of the file.

    Returns:
        The classification for the file.
    """
    extension = Path(filename).suffix.lower()
    if mime_type in _IMAGE_MIME_TYPES:
        return FileKind.IMAGE
    if extension in _TEXT_EXTENSIONS:
        return FileKind.TEXT
    if extension in _DOCUMENT_EXTENSIONS:
        return FileKind.DOCUMENT
    if mime_type.startswith("text/"):
        return FileKind.TEXT
    return FileKind.OTHER


def detect_mime_type(filename: str, content: bytes) -> str:
    """Determine the MIME type of an uploaded file.

    Args:
        filename: Sanitized display name of the file.
        content: The uploaded bytes.

    Returns:
        The content-sniffed MIME type, or the filename-derived type, or
        ``application/octet-stream`` when neither is known.
    """
    kind = filetype.guess(content)
    if kind is not None:
        return str(kind.mime)
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


async def _deduplicated_filename(
    session: AsyncSession,
    user_id: str,
    filename: str,
) -> str:
    """Find a free display name for a new file.

    Args:
        session: Active async session; the existence check relies on the
            session's autoflush so pending rows are visible.
        user_id: Owner whose library is checked.
        filename: The desired display name.

    Returns:
        ``filename`` when it is free, otherwise the first free variant of the
        form ``stem(2)ext``, ``stem(3)ext``, ….
    """
    stem, extension = Path(filename).stem, Path(filename).suffix
    candidate, counter = filename, 2
    while await session.scalar(select_file_id_by_name(user_id=user_id, filename=candidate)):
        candidate = f"{stem}({counter}){extension}"
        counter += 1
    return candidate


@dataclass(frozen=True)
class NewLibraryFile:
    model: UserFileModel
    storage_key: str
    artifact: ArtifactSummary


async def new_library_file(
    *,
    user_id: str,
    original_name: str,
    content: bytes,
    session: AsyncSession,
) -> NewLibraryFile:
    """Add bytes to a user's library inside the caller's transaction; no commit.

    Used when another domain copies a file in (US-60.3 course files). The caller
    deletes ``storage_key`` if its transaction fails, and calls
    :func:`start_file_ingestion` after it commits.
    """
    original_name = sanitize_filename(original_name)
    if len(content) > config.max_upload_file_size_bytes:
        raise BadDataException(
            f'File "{original_name}" exceeds the {config.max_upload_file_size_bytes} byte upload limit',
        )
    filename = await _deduplicated_filename(session, user_id, original_name)
    mime_type = detect_mime_type(filename, content)
    file_kind = classify_file(filename, mime_type)
    thumbnail = await asyncio.to_thread(generate_thumbnail, content) if file_kind is FileKind.IMAGE else None
    file_id = uuid.uuid4()
    storage_key = await save_off_loop(get_file_store(), user_id, file_id, Path(original_name).suffix, content)
    model = UserFileModel(
        id=file_id,
        storage_key=storage_key,
        user_id=user_id,
        filename=filename,
        original_name=original_name,
        size=len(content),
        mime_type=mime_type,
        kind=file_kind,
        sha256=await sha256_bytes(content),
        content_status=FileContentStatus.PENDING,
        thumbnail=thumbnail,
    )
    session.add(model)
    await session.flush()
    artifact = await ensure_artifact(file_id=file_id, user_id=user_id, session=session)
    return NewLibraryFile(model=model, storage_key=storage_key, artifact=artifact)


def start_file_ingestion(file: NewLibraryFile) -> None:
    """Queue knowledge processing for a file from :func:`new_library_file`, after commit."""
    start_ingestion(user_id=file.model.user_id, file_id=file.model.id, artifact=file.artifact)


async def upload_files(
    *,
    user_id: str,
    uploads: list[UploadFile],
    session: AsyncSession,
) -> UserFileList:
    """Store one or more uploaded files in the caller's library.

    Each upload is sanitized, size-checked, de-duplicated, classified and
    written to the file store. A pending knowledge artifact is created in the
    same transaction, and ingestion jobs are queued only after the commit
    succeeds.

    Args:
        user_id: Owner the files belong to.
        uploads: The uploaded files.
        session: Active async session; the transaction is committed here.

    Returns:
        The files that now exist for the caller. Re-uploading identical bytes
        under the same original name reuses the existing row instead of
        creating a second copy.

    Raises:
        BadDataException: If a filename is malformed, an extension is denied,
            or the files exceed the upload size limit, alone or together.
    """
    created: list[UserFileModel] = []
    artifacts = []
    store = get_file_store()
    saved: list[str] = []
    # One limit for the whole request, as nginx and the Next.js proxy apply it
    # (US-86.5): one large file or several smaller ones.
    remaining = config.max_upload_file_size_bytes
    try:
        for upload in uploads:
            original_name = sanitize_filename(upload.filename or "")
            content = await upload.read(remaining + 1)
            if len(content) > remaining:
                raise BadDataException(
                    f'File "{original_name}" exceeds the {config.max_upload_file_size_bytes} byte upload limit'
                    if remaining == config.max_upload_file_size_bytes
                    else f"These files together exceed the {config.max_upload_file_size_bytes} byte upload limit",
                )
            remaining -= len(content)
            sha256 = await sha256_bytes(content)
            existing = await session.scalar(
                select_file_by_content(user_id=user_id, original_name=original_name, sha256=sha256)
            )
            # Reuse only an intact, same-name object. Different content retains the
            # existing name-collision behavior, and ownership is always user-scoped.
            if existing is not None and await store.exists(user_id, existing.storage_key):
                if existing not in created:
                    created.append(existing)
                continue

            filename = await _deduplicated_filename(session, user_id, original_name)
            mime_type = detect_mime_type(filename, content)

            file_kind = classify_file(filename, mime_type)
            thumbnail = await asyncio.to_thread(generate_thumbnail, content) if file_kind is FileKind.IMAGE else None

            file_id = uuid.uuid4()
            storage_key = await save_off_loop(store, user_id, file_id, Path(original_name).suffix, content)
            saved.append(storage_key)
            model = UserFileModel(
                id=file_id,
                storage_key=storage_key,
                user_id=user_id,
                filename=filename,
                original_name=original_name,
                size=len(content),
                mime_type=mime_type,
                kind=file_kind,
                sha256=sha256,
                content_status=FileContentStatus.PENDING,
                thumbnail=thumbnail,
            )
            session.add(model)
            created.append(model)

        # Canonical knowledge state is created with the file, before any
        # collection references it. Processing is queued separately so an
        # upload transaction remains bounded and atomic.
        for file in created:
            artifacts.append(
                await ensure_artifact(
                    file_id=file.id,
                    user_id=file.user_id,
                    session=session,
                )
            )
        await session.commit()
    except (Exception, asyncio.CancelledError):
        await session.rollback()
        for filename in saved:
            store.delete(user_id, filename)
        raise
    for file, artifact in zip(created, artifacts, strict=True):
        start_ingestion(user_id=user_id, file_id=file.id, artifact=artifact)
    return UserFileList(files=await describe_files(user_id=user_id, files=created, session=session))


"""Upper bound on the source chunks used to build a file's centroid direction."""

"""How many candidate chunks to pull per requested similar file."""


async def delete_user_file(*, user_id: str, filename: str, session: AsyncSession) -> UserFile:
    """Delete one of the caller's files and everything derived from it.

    The file's knowledge artifacts, chat and project references and stored
    bytes are removed, and its vectors are purged.

    Args:
        user_id: Owner of the file.
        filename: Display name of the file.
        session: Active async session; the deletion is committed here.

    Returns:
        The deleted file's metadata as it was just before deletion.

    Raises:
        NotFoundException: If the caller owns no file with that name.
    """
    file = await _owned_file(user_id=user_id, filename=filename, session=session)
    await require_not_course_managed(user_id=user_id, record_ids=[file.id], session=session)
    response = (await describe_files(user_id=user_id, files=[file], session=session))[0]
    await _remove_file_knowledge_records(file_id=file.id, session=session)
    file_id = file.id
    await session.delete(file)
    await session.commit()
    try:
        await delete_file_vectors(user_id=user_id, file_id=file_id)
    except Exception:
        # Database/source deletion remains authoritative; a restarted worker
        # cannot restore vectors because its file/artifact row is gone.
        logger.warning("Could not remove knowledge vectors for deleted file", extra={"file_id": str(file_id)})
    try:
        get_file_store().delete(user_id, file.storage_key)
    except Exception:
        # The row is already gone, so the deletion succeeded. A source that
        # cannot be removed must not turn a completed delete into a failure.
        logger.warning("Could not remove stored source for deleted file", extra={"file_id": str(file_id)})
    return response


async def _remove_file_knowledge_records(*, file_id: uuid.UUID, session: AsyncSession) -> None:
    """Cancel and remove file-owned knowledge state before deleting its source.

    This explicit cleanup is required even though production databases enforce
    foreign keys: deterministic test/development SQLite connections may not
    enable cascade actions.

    Args:
        file_id: The file whose derived state should be removed.
        session: Active async session; no commit happens here (the caller
            owns the transaction).
    """
    from asterism.domains.chat.file_references import detach_deleted_file as detach_chat_file
    from asterism.domains.projects.file_references import detach_deleted_file

    await detach_chat_file(file_id=file_id, session=session)
    source = await session.get(UserFileModel, file_id)
    if source is not None:
        await detach_deleted_file(user_id=source.user_id, file_id=file_id, session=session)
    await remove_artifacts(file_id=file_id, session=session)


async def delete_user_files(
    *,
    user_id: str,
    filenames: list[str],
    session: AsyncSession,
) -> UserFileList:
    """Delete several of the caller's files and everything derived from them.

    Args:
        user_id: Owner of the files.
        filenames: Display names of the files to delete. Unknown names are
            ignored.
        session: Active async session; the deletion is committed here.

    Returns:
        The deleted files' metadata as it was just before deletion.
    """
    deleted_files: list[UserFile] = []
    storage_keys: list[str] = []
    store = get_file_store()

    try:
        async with get_async_db_session(session) as session:
            by_name = {
                file.filename: file
                for file in await session.scalars(select_files_by_names(user_id=user_id, filenames=filenames))
            }
            # Request order, each file once; unknown names are skipped.
            files = [by_name[name] for name in dict.fromkeys(filenames) if name in by_name]
            await require_not_course_managed(user_id=user_id, record_ids=[file.id for file in files], session=session)
            deleted_files = await describe_files(user_id=user_id, files=files, session=session) if files else []
            for file in files:
                await _remove_file_knowledge_records(file_id=file.id, session=session)
                storage_keys.append(file.storage_key)
                await session.delete(file)
            await session.commit()
    except Exception:
        await session.rollback()
        raise

    for storage_key in storage_keys:
        try:
            store.delete(user_id, storage_key)
        except Exception:
            # If the file is missing from the store, we still want to return a successful response.
            logger.warning("Could not remove stored source for deleted file", extra={"storage_key": storage_key})

    if deleted_files:
        for file in deleted_files:
            try:
                await delete_file_vectors(user_id=user_id, file_id=file.id)
            except Exception:
                logger.warning("Could not remove knowledge vectors for deleted file", extra={"file_id": str(file.id)})

    return UserFileList(files=deleted_files)


async def download_file_by_id(*, user_id: str, file_id: uuid.UUID, session: AsyncSession) -> FileResponse:
    """Download the original bytes of one of the caller's files by its id.

    Args:
        user_id: Owner of the file.
        file_id: Identifier of the file.
        session: Active async session; no commit happens here.

    Returns:
        A file response carrying the stored bytes.

    Raises:
        NotFoundException: If the file does not exist or its bytes are gone.
    """
    file = await session.scalar(select_files_by_ids(user_id=user_id, file_ids=[file_id]))
    if file is None:
        raise NotFoundException("File not found")
    store = get_file_store()
    if not await store.exists(user_id, file.storage_key):
        raise NotFoundException("File not found")
    return FileResponse(
        path=store.local_path(user_id, file.storage_key),
        filename=file.original_name,
        media_type=file.mime_type,
        headers={"Cache-Control": "private, no-store", **SOURCE_RESPONSE_HEADERS},
    )


__all__ = [
    "NewLibraryFile",
    "SOURCE_RESPONSE_HEADERS",
    "cancel_file_knowledge_processing",
    "classify_file",
    "delete_user_file",
    "delete_user_files",
    "detect_mime_type",
    "download_file_by_id",
    "get_file_info_by_id",
    "get_file_knowledge_status",
    "get_similar_files",
    "get_user_file",
    "get_user_file_info",
    "list_user_files",
    "logger",
    "new_library_file",
    "regenerate_file_knowledge",
    "sanitize_filename",
    "start_file_ingestion",
    "upload_files",
    "validate_owned_file_ids",
]
