"""Doubles for the knowledge domain's injected collaborators.

The knowledge domain reads its sources through a narrow contract, so tests
supply a reader instead of building a source file and its bytes.
"""

import uuid
from pathlib import Path

from asterism.domains.knowledge.sources import SourceContent, SourceFile


class FakeSourceReader:
    """A source reader that returns canned content.

    Attributes:
        text: The converted text the reader reports.
        is_image: Whether the source is reported as an image.
        name: The source file's display name.
        mime_type: The source file's MIME type.
        path: The source file's bytes path.
    """

    def __init__(
        self,
        *,
        text: str | None = "hello world",
        is_image: bool = False,
        name: str = "notes.txt",
        mime_type: str = "text/plain",
        path: Path | None = None,
    ) -> None:
        self.text = text
        self.is_image = is_image
        self.name = name
        self.mime_type = mime_type
        self.path = path or Path("/tmp/asterism-fake-source")

    async def read_source(
        self,
        *,
        file_id: uuid.UUID,
        user_id: str,
        session: object,
    ) -> SourceContent:
        """Return the canned content of one source file.

        Args:
            file_id: The source file to read.
            user_id: The file's owner.
            session: Active async session (unused).

        Returns:
            The canned source content.
        """
        return SourceContent(
            file=SourceFile(
                id=file_id,
                user_id=user_id,
                name=self.name,
                mime_type=self.mime_type,
                is_image=self.is_image,
                path=self.path,
            ),
            text=self.text,
        )


def fake_source(
    *,
    file_id: uuid.UUID,
    user_id: str,
    text: str | None = "hello world",
    is_image: bool = False,
    name: str = "notes.txt",
    mime_type: str = "text/plain",
    path: Path | None = None,
) -> SourceContent:
    """Build the source content a fake reader would report.

    Args:
        file_id: The source file.
        user_id: The file's owner.
        text: The converted text.
        is_image: Whether the source is an image.
        name: The source file's display name.
        mime_type: The source file's MIME type.
        path: The source file's bytes path.

    Returns:
        The canned source content.
    """
    return SourceContent(
        file=SourceFile(
            id=file_id,
            user_id=user_id,
            name=name,
            mime_type=mime_type,
            is_image=is_image,
            path=path or Path("/tmp/asterism-fake-source"),
        ),
        text=text,
    )
