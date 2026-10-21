"""Reading source files for the knowledge domain.

The knowledge domain never imports the files domain. It reads its sources
through the narrow contract in :mod:`asterism.domains.knowledge.sources`, and
this module provides the implementation: it converts the stored bytes to plain
text and resolves the source path.
"""

import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.files.models import FileContentStatus, FileKind, UserFileModel
from asterism.domains.files.processor import ensure_file_processed
from asterism.domains.files.store import get_file_store
from asterism.domains.knowledge.sources import (
    SourceContent,
    SourceFile,
    SourceUnavailableError,
)


class FileSourceReader:
    """Reads a source file's bytes and converted text for the knowledge domain."""

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
            The source file and its converted text. An image has no text.

        Raises:
            SourceUnavailableError: If the file could not be converted into
                usable content.
        """
        file = await session.get(UserFileModel, file_id)
        if file is None or file.user_id != user_id:
            raise SourceUnavailableError("The source file is unavailable")
        processed = await ensure_file_processed(file=file, session=session)
        if processed.content_status is not FileContentStatus.READY:
            raise SourceUnavailableError(processed.content_error or "The file could not be processed")
        return SourceContent(
            file=SourceFile(
                id=processed.id,
                user_id=processed.user_id,
                name=processed.original_name,
                mime_type=processed.mime_type,
                is_image=processed.kind is FileKind.IMAGE,
                path=self._source_path(processed),
            ),
            text=processed.content_cache,
        )

    def _source_path(self, file: UserFileModel) -> Path:
        """Resolve the stored source bytes of one file.

        Args:
            file: The source file row.

        Returns:
            The path of the stored source.
        """
        return get_file_store().open(file.user_id, file.storage_key)
