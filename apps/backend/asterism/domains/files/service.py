import base64
import hashlib
import io
import mimetypes
import re
from pathlib import Path
from typing import Literal

import filetype
from fastapi import UploadFile
from fastapi.responses import FileResponse
from PIL.TiffImagePlugin import ImageOps
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.file_utils import get_file_mime_type
from asterism.core import config
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.db.database import get_async_db_session

from .models import FileContentStatus, FileKind, UserFileModel
from .processor import MarkItDownFileProcessor
from .schemas import UserFile, UserFileList
from .store import LocalFileStore

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
_IMAGE_MIME_TYPES = {
    "image/bmp",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
}
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


def get_file_store() -> LocalFileStore:
    return LocalFileStore(config.files_root)


def _legacy_filename(filename: str) -> str:
    # Preserve the former download endpoint's handling of URL-encoded/hidden names.
    return re.sub(r"^\.+", "", re.sub("%2E", ".", filename, flags=re.IGNORECASE))


def get_user_file(user_id: str, filename: str) -> FileResponse:
    filename = _legacy_filename(filename)
    try:
        requested_path = get_file_store().open(user_id, filename)
    except ValueError as error:
        raise BadDataException("Access to file is denied") from error

    if not requested_path.is_file():
        raise NotFoundException("Access to file is denied")

    return FileResponse(
        path=requested_path,
        filename=filename,
        media_type=get_file_mime_type(requested_path),
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


async def get_user_file_info(
    user_id: str,
    filename: str,
    session: AsyncSession | None = None,
) -> UserFile:
    filename = _legacy_filename(filename)
    async with get_async_db_session(session) as session:
        statement = select(UserFileModel).where(
            UserFileModel.user_id == user_id,
            UserFileModel.filename == filename,
        )
        file = await session.scalar(statement)
        if file is None:
            raise NotFoundException("Access to file is denied")

        return UserFile.model_validate(file)


def sanitize_filename(name: str) -> str:
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
    kind = filetype.guess(content)
    if kind is not None:
        return str(kind.mime)
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


async def _deduplicated_filename(session: AsyncSession, store: LocalFileStore, user_id: str, filename: str) -> str:
    stem, extension = Path(filename).stem, Path(filename).suffix
    candidate, counter = filename, 2
    while (
        await session.scalar(
            select(UserFileModel.id).where(
                UserFileModel.user_id == user_id,
                UserFileModel.filename == candidate,
            )
        )
        or store.open(user_id, candidate).exists()
    ):
        candidate = f"{stem}({counter}){extension}"
        counter += 1
    return candidate


async def upload_files(*, user_id: str, uploads: list[UploadFile], session: AsyncSession) -> UserFileList:
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
                    f'File "{original_name}" exceeds the {config.max_upload_file_size_bytes} byte upload limit'
                )
            sha256 = hashlib.sha256(content).hexdigest()
            existing = await session.scalar(
                select(UserFileModel).where(
                    UserFileModel.user_id == user_id,
                    UserFileModel.filename == original_name,
                    UserFileModel.sha256 == sha256,
                )
            )
            # Reuse only an intact, same-name object. Different content retains the
            # existing name-collision behavior, and ownership is always user-scoped.
            if existing is not None and store.open(user_id, existing.filename).is_file():
                if existing not in created:
                    created.append(existing)
                continue

            filename = await _deduplicated_filename(session, store, user_id, original_name)
            mime_type = detect_mime_type(filename, content)

            thumbnail: str | None = None
            if classify_file(filename, mime_type) == FileKind.IMAGE:
                from PIL import Image, UnidentifiedImageError

                try:
                    with Image.open(io.BytesIO(content)) as img:
                        img = ImageOps.exif_transpose(img)
                        img = img.convert("RGB")
                        orig_w, orig_h = img.size
                        target_w = 128
                        target_h = 128
                        if orig_w > orig_h:
                            target_h = int(orig_h * (target_w / orig_w))
                        else:
                            target_w = int(orig_w * (target_h / orig_h))
                        thumbnail_img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
                        buffered = io.BytesIO()
                        thumbnail_img.save(buffered, format="jpeg")
                        encoded_img = base64.b64encode(buffered.getvalue()).decode("utf-8")
                        thumbnail = f"data:image/jpeg;base64,{encoded_img}"
                except (UnidentifiedImageError, OSError):
                    # MIME detection may classify a truncated image by its header.
                    # Preserve the upload, but omit a thumbnail that cannot be decoded.
                    pass

            model = UserFileModel(
                user_id=user_id,
                filename=filename,
                original_name=original_name,
                size=len(content),
                mime_type=mime_type,
                kind=classify_file(filename, mime_type),
                sha256=sha256,
                content_status=FileContentStatus.PENDING,
                thumbnail=thumbnail,
            )
            store.save(user_id, filename, content)
            saved.append(filename)
            session.add(model)
            created.append(model)
        # Canonical knowledge state is created with the file, before any
        # collection references it. Processing is queued separately so an
        # upload transaction remains bounded and atomic.
        from asterism.domains.knowledge.service import ensure_file_knowledge_artifact

        for file in created:
            artifacts.append(await ensure_file_knowledge_artifact(file=file, session=session))
        await session.commit()
        from asterism.domains.knowledge.runtime import knowledge_ingestion_jobs

        for file, artifact in zip(created, artifacts, strict=True):
            if artifact.status.value in {"pending", "failed"}:
                knowledge_ingestion_jobs.enqueue(user_id=user_id, file_id=file.id, artifact_id=artifact.id)
    except Exception:
        await session.rollback()
        for filename in saved:
            store.delete(user_id, filename)
        raise
    return UserFileList(files=[UserFile.model_validate(file) for file in created])


async def ensure_file_processed(*, file: UserFileModel, session: AsyncSession) -> UserFileModel:
    return await MarkItDownFileProcessor(get_file_store()).ensure_processed(file, session)  # pyright: ignore[reportArgumentType]


async def list_user_files(
    *,
    user_id: str,
    session: AsyncSession,
    page: int = 1,
    page_size: int = 50,
    sort_by: Literal["name", "kind", "date", "size"] = "name",
    query: str | None = None,
) -> UserFileList:
    order_by_column = UserFileModel.kind
    if sort_by == "name":
        order_by_column = UserFileModel.filename
    if sort_by == "date":
        order_by_column = UserFileModel.created_at
    if sort_by == "size":
        order_by_column = UserFileModel.size.desc()

    statement = (
        select(UserFileModel)
        .where(UserFileModel.user_id == user_id, UserFileModel.filename.ilike(f"%{query}%") if query else True)  # pyright: ignore[reportArgumentType]
        .order_by(order_by_column)
    )
    total = await session.scalar(select(func.count()).select_from(statement.subquery()))
    result = await session.scalars(
        statement.order_by(UserFileModel.created_at.desc(), UserFileModel.filename)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return UserFileList(
        files=[UserFile.model_validate(file) for file in result],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


async def delete_user_file(*, user_id: str, filename: str, session: AsyncSession) -> UserFile:
    file = await session.scalar(
        select(UserFileModel).where(UserFileModel.user_id == user_id, UserFileModel.filename == filename)
    )
    if file is None:
        raise NotFoundException("File not found")
    from asterism.domains.knowledge.models import FileKnowledgeArtifactModel
    from asterism.domains.knowledge.runtime import knowledge_ingestion_jobs, vector_store

    artifact_ids = list(
        await session.scalars(
            select(FileKnowledgeArtifactModel.id).where(FileKnowledgeArtifactModel.file_id == file.id)
        )
    )
    for artifact_id in artifact_ids:
        knowledge_ingestion_jobs.cancel(str(artifact_id))
    response = UserFile.model_validate(file)
    file_id = file.id
    await session.delete(file)
    await session.commit()
    try:
        await vector_store.delete_file(user_id=user_id, file_id=str(file_id))
    except Exception:
        # Database/source deletion remains authoritative; a restarted worker
        # cannot restore vectors because its file/artifact row is gone.
        pass
    get_file_store().delete(user_id, filename)
    return response


async def delete_user_files(
    *,
    user_id: str,
    filenames: list[str],
    session: AsyncSession,
) -> UserFileList:
    deleted_files: list[UserFile] = []
    store = get_file_store()

    try:
        async with get_async_db_session(session) as session:
            for filename in filenames:
                file = await session.scalar(
                    select(UserFileModel).where(
                        UserFileModel.user_id == user_id,
                        UserFileModel.filename == filename,
                    )
                )
                if file is not None:
                    from asterism.domains.knowledge.models import FileKnowledgeArtifactModel
                    from asterism.domains.knowledge.runtime import knowledge_ingestion_jobs

                    artifact_ids = list(
                        await session.scalars(
                            select(FileKnowledgeArtifactModel.id).where(FileKnowledgeArtifactModel.file_id == file.id)
                        )
                    )
                    for artifact_id in artifact_ids:
                        knowledge_ingestion_jobs.cancel(str(artifact_id))
                    deleted_files.append(UserFile.model_validate(file))
                    await session.delete(file)
            await session.commit()
    except Exception:
        await session.rollback()
        raise

    for file in deleted_files:
        try:
            store.delete(user_id, file.filename)
        except Exception:
            # If the file is missing from the store, we still want to return a successful response.
            pass

    if deleted_files:
        from asterism.domains.knowledge.runtime import vector_store

        for file in deleted_files:
            try:
                await vector_store.delete_file(user_id=user_id, file_id=str(file.id))
            except Exception:
                pass

    return UserFileList(files=deleted_files)
