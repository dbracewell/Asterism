"""The source files that knowledge is derived from.

The knowledge domain reads its sources through this narrow contract, so no
module under it imports the files domain. The files domain owns the source
bytes and the conversion, and provides the implementation.

The reader is installed by the application at startup, where the two domains
are composed.
"""

import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession


class SourceUnavailableError(RuntimeError):
    """A source file could not be turned into usable content."""


@dataclass(frozen=True)
class SourceFile:
    """One source file that knowledge can be derived from.

    Attributes:
        id: The source file's identifier.
        user_id: The file's owner.
        name: The file's display name.
        mime_type: The file's detected MIME type.
        is_image: Whether the file is an image, so its bytes are embedded
            visually instead of being converted to text.
        path: The source bytes path.
    """

    id: uuid.UUID
    user_id: str
    name: str
    mime_type: str
    is_image: bool
    path: Path


@dataclass(frozen=True)
class SourceContent:
    """The readable content of one source file.

    Attributes:
        file: The source file.
        text: The converted plain text, or ``None`` when the file has none.
    """

    file: SourceFile
    text: str | None


class SourceReader(Protocol):
    """Reads the source files that knowledge is derived from."""

    async def read_source(
        self,
        *,
        file_id: uuid.UUID,
        user_id: str,
        session: AsyncSession,
    ) -> SourceContent:
        """Return the readable content of one source file.

        Args:
            file_id: The source file to read.
            user_id: The file's owner.
            session: Active async session.

        Returns:
            The source file and its converted text.

        Raises:
            SourceUnavailableError: If the file could not be converted into
                usable content.
        """
        ...


_reader: SourceReader | None = None


def configure_source_reader(reader: SourceReader) -> None:
    """Install the reader that supplies source files to the knowledge domain.

    Args:
        reader: The implementation that reads source files.
    """
    global _reader
    _reader = reader


def get_source_reader() -> SourceReader:
    """Return the installed source reader.

    Returns:
        The registered reader.

    Raises:
        RuntimeError: If no reader has been installed. The knowledge domain
            cannot derive knowledge from a source it cannot read.
    """
    if _reader is None:
        raise RuntimeError("The knowledge source reader has not been configured")
    return _reader
