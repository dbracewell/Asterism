"""Use-case orchestration for the file domain.

This module is the transactional boundary: it coordinates the database, the
file store, the content processor and the knowledge-ingestion runtime. Two
rules shape the code here:

- The database is authoritative. Bytes are written only after the row exists
  (or removed only after the row is gone), and the two are reconciled on
  failure so a half-completed upload never leaves an orphan source.
- Every lookup is scoped by ``user_id``; ownership is never taken from the
  request payload.
"""

import asyncio
import hashlib
import mimetypes
import re
import uuid
from pathlib import Path
from typing import Literal

import filetype
from fastapi import UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.images import generate_thumbnail
from asterism.common.log import get_logger
from asterism.core import config
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.db.database import get_async_db_session
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel, FileKnowledgeArtifactStatus
from asterism.domains.knowledge.processing import ensure_file_knowledge_artifact
from asterism.domains.knowledge.queries import select_newest_file_artifact
from asterism.domains.knowledge.schemas import FileKnowledgeArtifact

from .listing import describe_files, file_knowledge_summaries, list_file_page
from .models import FileContentStatus, FileKind, UserFileModel
from .processor import ensure_file_processed as ensure_file_processed
from .queries import select_owned_files
from .schemas import SimilarFile, SimilarFileList, UserFile, UserFileList
from .store import get_file_store as get_file_store

logger = get_logger("FilesService")

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
        requested_path = get_file_store().open(user_id, file.storage_key)
        if not requested_path.is_file():
            raise NotFoundException("Access to file is denied")

        etag = f'"{file.sha256}"'
        headers = {
            "Cache-Control": "private, no-cache",
            "ETag": etag,
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


async def get_user_file_info(
    user_id: str,
    filename: str,
    session: AsyncSession | None = None,
) -> UserFile:
    """Get metadata for one of the caller's files.

    Args:
        user_id: Owner of the file.
        filename: Display name of the file.
        session: Optional existing session to reuse; a new one is opened when
            omitted.

    Returns:
        The file's metadata, including project and knowledge context.

    Raises:
        NotFoundException: If the file does not exist.
    """
    async with get_async_db_session(session) as session:
        statement = select(UserFileModel).where(
            UserFileModel.user_id == user_id,
            UserFileModel.filename == filename,
        )
        file = await session.scalar(statement)
        if file is None:
            raise NotFoundException("File does not exist")

        return (await describe_files(user_id=user_id, files=[file], session=session))[0]


def sanitize_filename(name: str) -> str:
    """Reduce a client-supplied filename to a safe, displayable name.

    Strips any directory component, leading dots and control characters, and
    rejects names that are empty, too long, or carry a denied extension.

    Args:
        name: Raw filename as sent by the client.

    Returns:
        The sanitized filename.

    Raises:
        BadDataException: If the name is malformed or carries a denied
            extension.
    """
    if not name or any(ord(character) < 32 for character in name):
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
    while await session.scalar(
        select(UserFileModel.id).where(
            UserFileModel.user_id == user_id,
            UserFileModel.filename == candidate,
        ),
    ):
        candidate = f"{stem}({counter}){extension}"
        counter += 1
    return candidate


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
            or a file exceeds the upload size limit.
    """
    created: list[UserFileModel] = []
    artifacts = []
    store = get_file_store()
    saved: list[str] = []
    try:
        for upload in uploads:
            original_name = sanitize_filename(upload.filename or "")
            content = await upload.read(config.max_upload_file_size_bytes + 1)
            if len(content) > config.max_upload_file_size_bytes:
                raise BadDataException(
                    f'File "{original_name}" exceeds the {config.max_upload_file_size_bytes} byte upload limit',
                )
            sha256 = hashlib.sha256(content).hexdigest()
            existing = await session.scalar(
                select(UserFileModel).where(
                    UserFileModel.user_id == user_id,
                    UserFileModel.original_name == original_name,
                    UserFileModel.sha256 == sha256,
                ),
            )
            # Reuse only an intact, same-name object. Different content retains the
            # existing name-collision behavior, and ownership is always user-scoped.
            if existing is not None and store.open(user_id, existing.storage_key).is_file():
                if existing not in created:
                    created.append(existing)
                continue

            filename = await _deduplicated_filename(session, user_id, original_name)
            mime_type = detect_mime_type(filename, content)

            file_kind = classify_file(filename, mime_type)
            thumbnail = await asyncio.to_thread(generate_thumbnail, content) if file_kind is FileKind.IMAGE else None

            file_id = uuid.uuid4()
            storage_key = store.save(user_id, file_id, Path(original_name).suffix, content)
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
                await ensure_file_knowledge_artifact(
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
    from asterism.domains.knowledge.runtime import start_file_ingestion_job

    for file, artifact in zip(created, artifacts, strict=True):
        if artifact.status.value in {"pending", "failed"}:
            start_file_ingestion_job(user_id=user_id, file_id=file.id, artifact_id=artifact.id)
    return UserFileList(files=await describe_files(user_id=user_id, files=created, session=session))


async def list_user_files(
    *,
    user_id: str,
    session: AsyncSession,
    page: int = 1,
    page_size: int = 50,
    sort_by: Literal["name", "kind", "date", "size"] = "name",
    query: str | None = None,
) -> UserFileList:
    """List the caller's files.

    Args:
        user_id: Owner whose files are listed.
        session: Active async session; no commit happens here.
        page: 1-based page number.
        page_size: Rows per page (1..100).
        sort_by: Primary ordering key.
        query: Optional case-insensitive substring filter on the file name.

    Returns:
        One page of the caller's files with project and knowledge context.
    """
    statement = select_owned_files(user_id=user_id, query=query, sort_by=sort_by)
    return await list_file_page(
        user_id=user_id,
        statement=statement,
        session=session,
        page=page,
        page_size=page_size,
    )


async def get_file_knowledge_status(
    *,
    user_id: str,
    filename: str,
    session: AsyncSession,
):
    """Get the knowledge-artifact status for one of the caller's files.

    The reported artifact is the one that represents the file's knowledge: the
    current generation when one exists (the generation retrieval serves), and
    otherwise the newest generation (the one still being built).

    Args:
        user_id: Owner of the file.
        filename: Display name of the file.
        session: Active async session; no commit happens here.

    Returns:
        The file's representative knowledge artifact.

    Raises:
        NotFoundException: If the file or its artifact does not exist.
    """
    file = await _owned_file(user_id=user_id, filename=filename, session=session)
    summaries = await file_knowledge_summaries(file_ids=[file.id], session=session)
    artifact = summaries.get(file.id)
    if artifact is None:
        raise NotFoundException("Knowledge processing record not found")
    return artifact


async def regenerate_file_knowledge(*, user_id: str, filename: str, session: AsyncSession):
    """Re-run knowledge processing for one of the caller's files.

    The newest generation is reset to ``pending`` and re-queued — that is the
    generation representing the latest processing attempt, so a failed
    replacement is retried rather than the serving generation being
    disturbed. Any in-flight job for that artifact is canceled first so the
    retry cannot race the previous run.

    Args:
        user_id: Owner of the file.
        filename: Display name of the file.
        session: Active async session; the reset is committed here.

    Returns:
        The artifact in its reset ``pending`` state.

    Raises:
        NotFoundException: If the file or its artifact does not exist.
    """
    from asterism.domains.knowledge.runtime import cancel_file_jobs, start_file_ingestion_job

    file = await _owned_file(user_id=user_id, filename=filename, session=session)
    artifact = await session.scalar(select_newest_file_artifact(file.id))
    if artifact is None:
        raise NotFoundException("Knowledge processing record not found")
    await cancel_file_jobs(artifact.id)
    artifact.status = FileKnowledgeArtifactStatus.PENDING
    artifact.error_code = None
    artifact.error_reason = None
    artifact.started_at = None
    artifact.completed_at = None
    artifact.caption_text = None
    artifact.caption_status = None
    artifact.caption_error_code = None
    artifact.caption_error_reason = None
    await session.commit()
    start_file_ingestion_job(user_id=user_id, file_id=file.id, artifact_id=artifact.id)
    return FileKnowledgeArtifact.model_validate(artifact)


async def cancel_file_knowledge_processing(*, user_id: str, filename: str, session: AsyncSession):
    """Cancel in-flight knowledge processing for one of the caller's files.

    The newest generation is targeted, so cancelling a pending replacement
    leaves the current (serving) generation untouched and the file stays
    searchable.

    Args:
        user_id: Owner of the file.
        filename: Display name of the file.
        session: Active async session; the cancellation is committed here.

    Returns:
        The artifact in its current state. Artifacts that are not pending or
        processing are returned unchanged.

    Raises:
        NotFoundException: If the file or its artifact does not exist.
    """
    from asterism.domains.knowledge.runtime import cancel_file_jobs

    file = await _owned_file(user_id=user_id, filename=filename, session=session)
    artifact = await session.scalar(select_newest_file_artifact(file.id))
    if artifact is None:
        raise NotFoundException("Knowledge processing record not found")
    if artifact.status in {FileKnowledgeArtifactStatus.PENDING, FileKnowledgeArtifactStatus.PROCESSING}:
        await cancel_file_jobs(artifact.id)
        artifact.status = FileKnowledgeArtifactStatus.CANCELED
        artifact.error_code = "canceled"
        artifact.error_reason = "Processing canceled by user"
        await session.commit()
    return FileKnowledgeArtifact.model_validate(artifact)


_SIMILARITY_MAX_SOURCE_VECTORS = 256
"""Upper bound on the source chunks used to build a file's centroid direction."""

_SIMILARITY_CHUNKS_PER_RESULT = 20
"""How many candidate chunks to pull per requested similar file."""


async def get_similar_files(*, user_id: str, filename: str, session: AsyncSession, limit: int = 5) -> SimilarFileList:
    """Find the caller's files most similar to one of their files.

    The query file's centroid direction is computed from its own chunk
    embeddings, searched against the caller's ready current artifacts, and the
    best-matching chunk per candidate file becomes its score.

    Args:
        user_id: Owner the search is scoped to.
        filename: Display name of the query file.
        session: Active async session; no commit happens here.
        limit: Maximum number of similar files to return.

    Returns:
        Ranked similar files with their cosine similarity score. The list is
        empty when the query file has no ready current artifact.

    Raises:
        NotFoundException: If the query file does not exist.
    """
    from asterism.domains.knowledge.runtime import vector_store

    file = await _owned_file(user_id=user_id, filename=filename, session=session)
    current = await session.scalar(
        select(FileKnowledgeArtifactModel).where(
            FileKnowledgeArtifactModel.file_id == file.id,
            FileKnowledgeArtifactModel.is_current.is_(True),
            FileKnowledgeArtifactModel.status == FileKnowledgeArtifactStatus.READY,
        ),
    )
    if current is None:
        return SimilarFileList(files=[])
    source_vectors = await vector_store.get_file_vectors(
        user_id=user_id,
        file_id=str(file.id),
        artifact_generation=current.generation,
        limit=_SIMILARITY_MAX_SOURCE_VECTORS,
    )
    if not source_vectors:
        return SimilarFileList(files=[])

    # Embeddings are unit-length, so the normalized mean is the file's centroid direction.
    dimension = len(source_vectors[0])
    centroid = [sum(vector[index] for vector in source_vectors) / len(source_vectors) for index in range(dimension)]
    norm = sum(value * value for value in centroid) ** 0.5
    if norm == 0:
        return SimilarFileList(files=[])
    centroid = [value / norm for value in centroid]

    candidates = {
        str(file_id): generation
        for file_id, generation in (
            await session.execute(
                select(FileKnowledgeArtifactModel.file_id, FileKnowledgeArtifactModel.generation).where(
                    FileKnowledgeArtifactModel.user_id == user_id,
                    FileKnowledgeArtifactModel.file_id != file.id,
                    FileKnowledgeArtifactModel.is_current.is_(True),
                    FileKnowledgeArtifactModel.status == FileKnowledgeArtifactStatus.READY,
                ),
            )
        ).all()
    }
    if not candidates:
        return SimilarFileList(files=[])
    hits = await vector_store.search(
        centroid,
        user_id=user_id,
        allowed_file_ids=list(candidates),
        limit=limit * _SIMILARITY_CHUNKS_PER_RESULT,
    )
    # LanceDB reports squared L2 distance; for unit vectors cosine = 1 - d / 2.
    best: dict[str, float] = {}
    for hit in hits:
        if candidates.get(hit.file_id) != hit.artifact_generation:
            continue
        best[hit.file_id] = max(best.get(hit.file_id, -1.0), min(1.0, max(-1.0, 1 - hit.score / 2)))
    ranked = sorted(best.items(), key=lambda item: item[1], reverse=True)[:limit]
    if not ranked:
        return SimilarFileList(files=[])
    models = {
        str(model.id): model
        for model in await session.scalars(
            select(UserFileModel).where(
                UserFileModel.user_id == user_id,
                UserFileModel.id.in_([uuid.UUID(file_id) for file_id, _ in ranked]),
            ),
        )
    }
    summaries = {
        str(file.id): file
        for file in await describe_files(
            user_id=user_id,
            files=list(models.values()),
            session=session,
        )
    }
    return SimilarFileList(
        files=[SimilarFile(file=summaries[file_id], score=score) for file_id, score in ranked if file_id in models],
    )


async def _owned_file(*, user_id: str, filename: str, session: AsyncSession) -> UserFileModel:
    """Load one of the caller's files by its display name.

    Args:
        user_id: Owner of the file.
        filename: Display name of the file.
        session: Active async session; no commit happens here.

    Returns:
        The matching file row.

    Raises:
        NotFoundException: If the caller owns no file with that name.
    """
    file = await session.scalar(
        select(UserFileModel).where(UserFileModel.user_id == user_id, UserFileModel.filename == filename),
    )
    if file is None:
        raise NotFoundException("File not found")
    return file


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
    file = await session.scalar(
        select(UserFileModel).where(UserFileModel.user_id == user_id, UserFileModel.filename == filename),
    )
    if file is None:
        raise NotFoundException("File not found")
    from asterism.domains.knowledge.runtime import vector_store

    response = (await describe_files(user_id=user_id, files=[file], session=session))[0]
    await _remove_file_knowledge_records(file_id=file.id, session=session)
    file_id = file.id
    await session.delete(file)
    await session.commit()
    try:
        await vector_store.delete_file(user_id=user_id, file_id=str(file_id))
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
    from asterism.domains.knowledge.models import FileKnowledgeArtifactModel
    from asterism.domains.knowledge.runtime import cancel_file_jobs
    from asterism.domains.projects.file_references import detach_deleted_file

    await detach_chat_file(file_id=file_id, session=session)
    source = await session.get(UserFileModel, file_id)
    if source is not None:
        await detach_deleted_file(user_id=source.user_id, file_id=file_id, session=session)
    artifact_ids = list(
        await session.scalars(
            select(FileKnowledgeArtifactModel.id).where(FileKnowledgeArtifactModel.file_id == file_id),
        ),
    )
    for artifact_id in artifact_ids:
        await cancel_file_jobs(artifact_id)
    await session.execute(delete(FileKnowledgeArtifactModel).where(FileKnowledgeArtifactModel.file_id == file_id))


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
            for filename in filenames:
                file = await session.scalar(
                    select(UserFileModel).where(
                        UserFileModel.user_id == user_id,
                        UserFileModel.filename == filename,
                    ),
                )
                if file is not None:
                    deleted_files.extend(await describe_files(user_id=user_id, files=[file], session=session))
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
        from asterism.domains.knowledge.runtime import vector_store

        for file in deleted_files:
            try:
                await vector_store.delete_file(user_id=user_id, file_id=str(file.id))
            except Exception:
                logger.warning("Could not remove knowledge vectors for deleted file", extra={"file_id": str(file.id)})

    return UserFileList(files=deleted_files)


async def validate_owned_file_ids(*, user_id: str, file_ids: list[uuid.UUID], session: AsyncSession) -> None:
    """Assert that every given file id belongs to the caller.

    Args:
        user_id: Owner the files must belong to.
        file_ids: File ids to validate.
        session: Active async session; no commit happens here.

    Raises:
        NotFoundException: If any id is not owned by the caller.
    """
    owned = set(
        await session.scalars(
            select(UserFileModel.id).where(
                UserFileModel.user_id == user_id,
                UserFileModel.id.in_(file_ids),
            ),
        ),
    )
    if owned != set(file_ids):
        raise NotFoundException("File not found")


async def get_file_info_by_id(*, user_id: str, file_id: uuid.UUID, session: AsyncSession) -> UserFile:
    """Get metadata for one of the caller's files by its id.

    Args:
        user_id: Owner of the file.
        file_id: Identifier of the file.
        session: Active async session; no commit happens here.

    Returns:
        The file's metadata, including project and knowledge context.

    Raises:
        NotFoundException: If the caller owns no file with that id.
    """
    file = await session.scalar(select_owned_files(user_id=user_id).where(UserFileModel.id == file_id))
    if file is None:
        raise NotFoundException("File not found")
    return (await describe_files(user_id=user_id, files=[file], session=session))[0]


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
    file = await session.scalar(select_owned_files(user_id=user_id).where(UserFileModel.id == file_id))
    if file is None:
        raise NotFoundException("File not found")
    path = get_file_store().open(user_id, file.storage_key)
    if not path.is_file():
        raise NotFoundException("File not found")
    return FileResponse(
        path=path,
        filename=file.original_name,
        media_type=file.mime_type,
        headers={"Cache-Control": "private, no-store"},
    )
