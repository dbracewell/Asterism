"""Model-facing file access. Ownership alone never grants runtime access.

Two independent gates protect every read:

1. ``ExecutionScope.allowed_file_ids`` — the static set derived when the
   execution scope was built.
2. ``RuntimeFileReader.authorize`` — a *live* re-check performed at read
   time, so a file detached from a chat/project mid-run stops being readable.

Both are re-validated after any potentially slow work (conversion, disk I/O)
so a revocation that happens during the read still wins.
"""

import base64
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.execution_scope import ExecutionScope

from .models import FileKind, UserFileModel
from .queries import select_owned_files
from .store import FileStore


@dataclass(frozen=True)
class FileModelInput:
    """The result of reading one file for model consumption.

    Exactly one of ``text`` or ``image_url`` carries usable content;
    ``reason`` explains why the file could not be turned into content.

    Attributes:
        text: Extracted plain text, for text and document files.
        image_url: ``data:`` URL holding the encoded image bytes.
        reason: Human-readable explanation when no content could be produced.
    """

    text: str | None = None
    image_url: str | None = None
    reason: str | None = None


class RuntimeFileReader:
    """Reads files for a model, enforcing live execution-scope authorization.

    The reader is constructed with its collaborators (authorizer, store, size
    ceiling, processor) so that it can be exercised in tests without touching
    global configuration.
    """

    def __init__(
        self,
        *,
        authorize: Callable[[ExecutionScope], Awaitable[frozenset[uuid.UUID]]],
        store: FileStore,
        max_image_bytes: int,
        process_file: Callable[[UserFileModel, AsyncSession], Awaitable[UserFileModel]],
    ) -> None:
        """Wire the reader to its collaborators.

        Args:
            authorize: Live authorization callback returning the file ids that
                are currently readable for the given scope.
            store: File store used to resolve and read the stored bytes.
            max_image_bytes: Ceiling for an image that may be sent to a model.
            process_file: Callback that ensures the file's converted-content
                cache is current.
        """
        self.authorize = authorize
        self.store = store
        self.max_image_bytes = max_image_bytes
        self.process_file = process_file

    async def validate_files(self, scope: ExecutionScope, file_ids: frozenset[uuid.UUID]) -> None:
        """Assert that every requested file is still readable for this scope.

        Args:
            scope: The execution scope the read belongs to.
            file_ids: Files the caller wants to read.

        Raises:
            BadDataException: If any file is outside the static scope or is no
                longer authorized.
        """
        if not file_ids <= scope.allowed_file_ids or not file_ids <= await self.authorize(scope):
            raise BadDataException("File access was revoked or is outside the execution context")

    async def read_for_model(
        self, scope: ExecutionScope, file_id: uuid.UUID, *, supports_vision: bool
    ) -> FileModelInput:
        """Read one file and turn it into model-ready content.

        Text and document files yield their cached text; images yield a
        ``data:`` URL when the model supports vision and the file is within
        the size ceiling. Anything else yields a :class:`FileModelInput` whose
        ``reason`` explains the refusal.

        Args:
            scope: The execution scope the read belongs to.
            file_id: The file to read.
            supports_vision: Whether the target model accepts image input.

        Returns:
            The model-facing content for the file.

        Raises:
            BadDataException: If the file is outside the scope, was revoked
                during the read, or does not exist for this user.
        """
        ids = frozenset({file_id})
        await self.validate_files(scope, ids)
        async with get_async_db_session() as db:
            file = await db.scalar(select_owned_files(user_id=scope.user_id).where(UserFileModel.id == file_id))
            if file is None:
                raise BadDataException("File is unavailable in this execution context")
            file = await self.process_file(file, db)
            kind, key, mime_type, size = file.kind, file.storage_key, file.mime_type, file.size
            text, error = file.content_cache, file.content_error
        # Processing may await remote/local knowledge derivation; do not release a revoked cache.
        await self.validate_files(scope, ids)
        if kind != FileKind.IMAGE:
            # An empty source is still an attached source: distinguish "no
            # cached text" from "cached empty text" so an empty file is not
            # reported as an unsupported type.
            if text is not None:
                return FileModelInput(text=text)
            return FileModelInput(reason=error or "file type is unsupported")
        if not supports_vision:
            return FileModelInput(reason="model does not support image input")
        if size > self.max_image_bytes:
            return FileModelInput(reason="file is too large or unavailable")
        try:
            path = self.store.open(scope.user_id, key)
            if not path.is_file() or path.stat().st_size > self.max_image_bytes:
                return FileModelInput(reason="file is too large or unavailable")
            # Bound the actual read too; metadata must not allow an oversized image.
            with path.open("rb") as source:
                content = source.read(self.max_image_bytes + 1)
            if len(content) > self.max_image_bytes:
                return FileModelInput(reason="file is too large or unavailable")
            encoded = base64.b64encode(content).decode("ascii")
        except (OSError, ValueError):
            return FileModelInput(reason="file is too large or unavailable")
        await self.validate_files(scope, ids)
        return FileModelInput(image_url=f"data:{mime_type};base64,{encoded}")
