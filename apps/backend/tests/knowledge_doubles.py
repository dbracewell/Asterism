"""Doubles for the knowledge domain's injected collaborators.

The knowledge domain reads its sources through a narrow contract, so tests
supply a reader instead of building a source file and its bytes.
"""

import uuid

from asterism.domains.knowledge.sources import SourceContent, SourceFile


class FakeSourceReader:
    """A source reader that returns canned content.

    Attributes:
        text: The converted text the reader reports.
        is_image: Whether the source is reported as an image.
        name: The source file's display name.
        mime_type: The source file's MIME type.
        image: The image bytes reported for an image source.
    """

    def __init__(
        self,
        *,
        text: str | None = "hello world",
        is_image: bool = False,
        name: str = "notes.txt",
        mime_type: str = "text/plain",
        image: bytes = b"fake-image",
    ) -> None:
        self.text = text
        self.is_image = is_image
        self.name = name
        self.mime_type = mime_type
        self.image = image

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
            ),
            text=self.text,
            image=self.image if self.is_image else None,
        )


def fake_source(
    *,
    file_id: uuid.UUID,
    user_id: str,
    text: str | None = "hello world",
    is_image: bool = False,
    name: str = "notes.txt",
    mime_type: str = "text/plain",
    image: bytes = b"fake-image",
) -> SourceContent:
    """Build the source content a fake reader would report.

    Args:
        file_id: The source file.
        user_id: The file's owner.
        text: The converted text.
        is_image: Whether the source is an image.
        name: The source file's display name.
        mime_type: The source file's MIME type.
        image: The image bytes reported for an image source.

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
        ),
        text=text,
        image=image if is_image else None,
    )
