"""Bounded conversion of stored sources to text (US-116.1).

Zip-based sources (DOCX, XLSX, PPTX, EPUB and plain zips) are checked before
conversion: their member count and total uncompressed size, read from the
central directory, must be within limits. Previews use the same check.
Conversion itself runs in a child process that is killed on timeout, so a
stuck or runaway converter stops using memory and threads.
"""

import asyncio
import os
import sys
import zipfile
from pathlib import Path

MAX_ARCHIVE_MEMBERS = 10_000
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
_WORKER = Path(__file__).with_name("convert_worker.py")
# The converter reads untrusted files; it gets no secrets or app settings.
_WORKER_ENVIRONMENT = ("PATH", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "HOME")


class ArchiveTooLarge(ValueError):
    """A zip-based source has too many members or expands too far."""


def check_archive(path: Path) -> None:
    """Refuse a zip-based source that is too big to open; other files pass.

    Raises:
        ArchiveTooLarge: If it has more than ``MAX_ARCHIVE_MEMBERS`` members or
            more than ``MAX_ARCHIVE_UNCOMPRESSED_BYTES`` uncompressed.
    """
    if not zipfile.is_zipfile(path):
        return
    try:
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
    except (OSError, zipfile.BadZipFile, ValueError) as error:
        raise ArchiveTooLarge("The archive cannot be read") from error
    if len(members) > MAX_ARCHIVE_MEMBERS:
        raise ArchiveTooLarge("The archive has too many members")
    if sum(member.file_size for member in members) > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
        raise ArchiveTooLarge("The archive expands beyond the size limit")


class ConversionFailed(RuntimeError):
    """The converter failed; the reason is not kept because it may quote the file."""


async def convert_file(path: Path, *, timeout: float, max_chars: int) -> str:
    """Convert ``path`` in a child process; at most ``max_chars + 1`` characters come back.

    Raises:
        TimeoutError: The conversion took longer than ``timeout``; the child was killed.
        ConversionFailed: The converter failed.
    """
    environment = {name: os.environ[name] for name in _WORKER_ENVIRONMENT if name in os.environ}
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-I",
        str(_WORKER),
        str(path),
        str(max_chars),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        env=environment,
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except BaseException:
        # Timed out or cancelled: the child must not keep running.
        if process.returncode is None:
            process.kill()
            await asyncio.shield(process.wait())
        raise
    if process.returncode != 0:
        raise ConversionFailed
    return output.decode("utf-8", "replace")
