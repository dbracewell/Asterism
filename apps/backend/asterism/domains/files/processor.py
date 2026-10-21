"""Conversion of stored sources into cached plain text.

The processor owns exactly one transition: ``PENDING`` → (``READY`` |
``UNSUPPORTED`` | ``FAILED``). It is idempotent and cheap to call repeatedly:
an already-processed file short-circuits unless its bytes changed on disk.
"""

import asyncio
from pathlib import Path
from typing import Protocol

from markitdown import MarkItDown
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.hashing import sha256_file
from asterism.core import config

from .models import FileContentStatus, FileKind, UserFileModel
from .store import FileStore, get_file_store

_TRUNCATION_MARKER = "\n… [content truncated]"
"""Appended to a converted cache that was cut off at the configured limit."""


class FileProcessor(Protocol):
    """
    A file processor is responsible for ensuring that a persisted user file has been processed and its content is
    available for use. The processor may perform operations such as converting the file to a different format,
    extracting text content, or generating previews. The processor should handle any necessary error handling and
    update the file's content status accordingly.
    """

    async def ensure_processed(
        self,
        file: UserFileModel,
        session: AsyncSession,
    ) -> UserFileModel:
        """Ensure the file's converted-content cache is up to date.

        Args:
            file: The file row to process. It is mutated in place.
            session: Active async session; the implementation commits its
                own status changes.

        Returns:
            The same file row, with ``content_status``/``content_cache``/
            ``content_error`` updated to reflect the outcome.
        """
        ...


class MarkItDownFileProcessor:
    """Bounded, content-safe conversion for persisted user files.

    "Bounded" covers both the input size (``max_process_file_size_bytes``)
    and the produced text (``max_converted_chars``); "content-safe" means
    converter errors are never surfaced to the caller, because they commonly
    embed fragments of the converted document.
    """

    def __init__(self, store: FileStore) -> None:
        """Bind the processor to the store that holds the source bytes.

        Args:
            store: File store used to resolve the file's storage key.
        """
        self.store = store

    @staticmethod
    def _truncate(content: str) -> str:
        """Cut converted text down to the configured character budget.

        Args:
            content: Full converted text.

        Returns:
            The text, possibly truncated and followed by the truncation marker.
        """
        if len(content) <= config.max_converted_chars:
            return content
        return content[: config.max_converted_chars] + _TRUNCATION_MARKER

    @staticmethod
    def _convert(path: Path) -> str:
        """Convert a file to plain text with MarkItDown.

        Args:
            path: Path of the stored source.

        Returns:
            The converted text.
        """
        return MarkItDown().convert(str(path)).text_content

    async def _convert_with_timeout(self, path: Path) -> str:
        """Run the (blocking) conversion off the event loop with a time limit.

        Args:
            path: Path of the stored source.

        Returns:
            The converted text.

        Raises:
            TimeoutError: If the conversion exceeds ``config.file_conversion_timeout_s``.
        """
        return await asyncio.wait_for(
            asyncio.to_thread(self._convert, path),
            timeout=config.file_conversion_timeout_s,
        )

    async def ensure_processed(
        self,
        file: UserFileModel,
        session: AsyncSession,
    ) -> UserFileModel:
        """Bring the file's converted-content cache up to date.

        The stored bytes are re-hashed when their size changed, which
        invalidates a stale cache. Otherwise an already-satisfied file
        returns immediately without touching the converter.

        Args:
            file: The file row to process. It is mutated in place.
            session: Active async session; status changes are committed here.

        Returns:
            The same file row with an updated ``content_status``.
        """
        path = self.store.open(file.user_id, file.storage_key)
        if not path.is_file():
            file.content_status = FileContentStatus.FAILED
            file.content_error = "File is no longer available"
            file.content_cache = None
            await session.commit()
            return file

        stat = path.stat()
        file_modified = stat.st_size != file.size
        if file_modified:
            digest = await asyncio.to_thread(sha256_file, path)
            if digest != file.sha256:
                file.sha256 = digest
                file.size = stat.st_size
                file.content_status = FileContentStatus.PENDING
                file.content_error = None
                file.content_cache = None

        if (
            file.content_status is not FileContentStatus.PENDING
            and not (
                file.content_status is FileContentStatus.FAILED
                and file.content_error == "File is too large to process"
                and file.size <= config.max_process_file_size_bytes
            )
            and file.sha256
        ):
            return file

        if not file_modified and not file.sha256:
            file.sha256 = await asyncio.to_thread(sha256_file, path)

        # A configured processing limit can be raised after an upload. Retry the
        # deterministic size failure when the file is attached again instead of
        # leaving it permanently unavailable until it is re-uploaded.
        if (
            file.content_status is FileContentStatus.FAILED
            and file.content_error == "File is too large to process"
            and file.size <= config.max_process_file_size_bytes
        ):
            file.content_status = FileContentStatus.PENDING
            file.content_error = None
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
        """Convert the source and store the result in the file's content cache.

        The file row is mutated but not committed; the caller commits.

        Args:
            file: The file row whose cache should be filled.
            path: Path of the stored source.
        """
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


async def ensure_file_processed(*, file: UserFileModel, session: AsyncSession) -> UserFileModel:
    """Ensure a file is processed using the default processor.

    Args:
        file: The file row to process.
        session: Active async session; status changes are committed here.

    Returns:
        The same file row with an updated ``content_status``.
    """
    return await MarkItDownFileProcessor(get_file_store()).ensure_processed(file, session)  # pyright: ignore[reportArgumentType]
