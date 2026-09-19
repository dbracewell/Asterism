import asyncio
import hashlib
from pathlib import Path
from typing import Protocol

from markitdown import MarkItDown
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core import config

from .models import FileContentStatus, FileKind, UserFileModel
from .store import FileStore

_TRUNCATION_MARKER = "\n… [content truncated]"


class FileProcessor(Protocol):
    async def ensure_processed(
        self, file: UserFileModel, session: AsyncSession
    ) -> UserFileModel: ...


class MarkItDownFileProcessor:
    """Bounded, content-safe conversion for persisted user files."""

    def __init__(self, store: FileStore) -> None:
        self.store = store

    @staticmethod
    def _truncate(content: str) -> str:
        if len(content) <= config.max_converted_chars:
            return content
        return content[: config.max_converted_chars] + _TRUNCATION_MARKER

    @staticmethod
    def _convert(path: Path) -> str:
        return MarkItDown().convert(str(path)).text_content

    async def _convert_with_timeout(self, path: Path) -> str:
        return await asyncio.wait_for(
            asyncio.to_thread(self._convert, path),
            timeout=config.file_conversion_timeout_s,
        )

    async def ensure_processed(
        self, file: UserFileModel, session: AsyncSession
    ) -> UserFileModel:
        path = self.store.open(file.user_id, file.filename)
        if not path.is_file():
            file.content_status = FileContentStatus.FAILED
            file.content_error = "File is no longer available"
            file.content_cache = None
            await session.commit()
            return file

        digest = await asyncio.to_thread(_sha256_file, path)
        if digest != file.sha256:
            file.sha256 = digest
            file.size = path.stat().st_size
            file.content_status = FileContentStatus.PENDING
            file.content_error = None
            file.content_cache = None

        if file.content_status is not FileContentStatus.PENDING:
            return file
        if file.kind is FileKind.IMAGE:
            file.content_status = FileContentStatus.READY
        elif file.kind is FileKind.OTHER:
            file.content_status = FileContentStatus.UNSUPPORTED
            file.content_error = "This file type is not supported"
        elif file.size > config.max_process_file_size_bytes:
            file.content_status = FileContentStatus.FAILED
            file.content_error = "File is too large to process"
        else:
            await self._process_content(file, path)
        await session.commit()
        return file

    async def _process_content(self, file: UserFileModel, path: Path) -> None:
        try:
            if file.kind is FileKind.TEXT:
                try:
                    content = await asyncio.to_thread(path.read_text, encoding="utf-8-sig")
                except UnicodeDecodeError:
                    content = await self._convert_with_timeout(path)
            else:
                content = await self._convert_with_timeout(path)
            file.content_cache = self._truncate(content)
            file.content_status = FileContentStatus.READY
            file.content_error = None
        except TimeoutError:
            file.content_status = FileContentStatus.FAILED
            file.content_error = "File conversion timed out"
        except Exception:
            # Converter errors often contain document content; never surface or log them.
            file.content_status = FileContentStatus.FAILED
            file.content_error = "File could not be processed"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
