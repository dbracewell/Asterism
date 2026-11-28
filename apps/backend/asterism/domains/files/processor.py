"""Conversion of stored sources into cached plain text.

The processor owns exactly one transition: ``PENDING`` → (``READY`` |
``UNSUPPORTED`` | ``FAILED``). It is idempotent and cheap to call repeatedly:
an already-processed file short-circuits unless its bytes changed on disk.
"""

import asyncio
import os
from collections import OrderedDict
from pathlib import Path
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.hashing import sha256_file
from asterism.core import config

from .conversion import ArchiveTooLarge, check_archive, convert_file
from .models import FileContentStatus, FileKind, UserFileModel
from .store import FileStore, get_file_store

_TRUNCATION_MARKER = "\n… [content truncated]"

# Files whose bytes last matched a digest, with what they looked like on disk
# then, so an unchanged file isn't hashed again on every use. Per process and
# bounded; a miss only costs a re-hash.
_VERIFIED_LIMIT = 4096
_verified: OrderedDict[tuple[str, str], tuple[tuple[int, int, int, int], str]] = OrderedDict()


def _disk_signature(stat: os.stat_result) -> tuple[int, int, int, int]:
    """Size, inode, and modification and change times: any rewrite changes one."""
    return (stat.st_size, stat.st_ino, stat.st_mtime_ns, stat.st_ctime_ns)


def _remember_verified(key: tuple[str, str], signature: tuple[int, int, int, int], digest: str) -> None:
    _verified[key] = (signature, digest)
    _verified.move_to_end(key)
    while len(_verified) > _VERIFIED_LIMIT:
        _verified.popitem(last=False)


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

    async def _convert_with_timeout(self, path: Path) -> str:
        """Check a zip-based source's size, then convert it in a child process with a time limit.

        Args:
            path: Path of the stored source.

        Returns:
            The converted text (at most one character past the cache limit).

        Raises:
            ArchiveTooLarge: If a zip-based source has too many members or expands too far.
            TimeoutError: If the conversion exceeds ``config.file_conversion_timeout_s``;
                the converter is stopped.
        """
        await asyncio.to_thread(check_archive, path)
        return await convert_file(path, timeout=config.file_conversion_timeout_s, max_chars=config.max_converted_chars)

    async def ensure_processed(
        self,
        file: UserFileModel,
        session: AsyncSession,
    ) -> UserFileModel:
        """Bring the file's converted-content cache up to date.

        The stored bytes are re-hashed unless they are unchanged on disk since
        they last matched the recorded digest; a change invalidates the cache.
        Otherwise an already-satisfied file returns immediately without
        touching the converter.

        Args:
            file: The file row to process. It is mutated in place.
            session: Active async session; status changes are committed here.

        Returns:
            The same file row with an updated ``content_status``.
        """
        if not await self.store.exists(file.user_id, file.storage_key):
            file.content_status = FileContentStatus.FAILED
            file.content_error = "File is no longer available"
            file.content_cache = None
            await session.commit()
            return file

        # The converter and digest stream from a real file.
        path = self.store.local_path(file.user_id, file.storage_key)
        stat = await asyncio.to_thread(path.stat)
        # The recorded digest is the authority on the stored bytes. The store
        # writes sources exclusively, so the bytes only change when something
        # outside the system rewrote them — and a stale cache would then be
        # served to the model while the download ETag still advertised the
        # old content. Verifying the digest is bounded, streams off the event
        # loop, and is the only check that catches a replaced source whose
        # length did not change. It is skipped while the file is unchanged on
        # disk since it last matched: a rewrite changes its change time, which
        # can't be set back.
        verified_as = (file.user_id, file.storage_key)
        signature = _disk_signature(stat)
        if _verified.get(verified_as) == (signature, file.sha256):
            _verified.move_to_end(verified_as)
            digest = file.sha256
        else:
            digest = await asyncio.to_thread(sha256_file, path)
            _remember_verified(verified_as, signature, digest)
        if digest != file.sha256:
            file.sha256 = digest
            file.size = stat.st_size
            file.content_status = FileContentStatus.PENDING
            file.content_error = None
            file.content_cache = None

        if file.content_status is not FileContentStatus.PENDING and not (
            file.content_status is FileContentStatus.FAILED
            and file.content_error == "File is too large to process"
            and file.size <= config.max_process_file_size_bytes
        ):
            return file

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
        except ArchiveTooLarge:
            # Not "too large to process": that one is retried when the limit is raised.
            file.content_status = FileContentStatus.FAILED
            file.content_error = "File expands beyond the processing limit"
        except Exception:  # ConversionFailed, or a text read that failed
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
