"""Model-facing file access. Ownership alone never grants runtime access."""

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
    text: str | None = None
    image_url: str | None = None
    reason: str | None = None


class RuntimeFileReader:
    def __init__(
        self,
        *,
        authorize: Callable[[ExecutionScope], Awaitable[frozenset[uuid.UUID]]],
        store: FileStore,
        max_image_bytes: int,
        process_file: Callable[[UserFileModel, AsyncSession], Awaitable[UserFileModel]],
    ) -> None:
        self.authorize = authorize
        self.store = store
        self.max_image_bytes = max_image_bytes
        self.process_file = process_file

    async def validate_files(self, scope: ExecutionScope, file_ids: frozenset[uuid.UUID]) -> None:
        if not file_ids <= scope.allowed_file_ids or not file_ids <= await self.authorize(scope):
            raise BadDataException("File access was revoked or is outside the execution context")

    async def read_for_model(
        self, scope: ExecutionScope, file_id: uuid.UUID, *, supports_vision: bool
    ) -> FileModelInput:
        ids = frozenset({file_id})
        await self.validate_files(scope, ids)
        async with get_async_db_session() as db:
            file = await db.scalar(select_owned_files(user_id=scope.user_id).where(UserFileModel.id == file_id))
            if file is None:
                raise BadDataException("File is unavailable in this execution context")
            file = await self.process_file(file, db)
            kind, key, mime_type, size = file.kind, file.storage_key, file.mime_type, file.size
            text, error = file.content_cache, file.content_error
        # Processing may await remote/local extraction; do not release a revoked cache.
        await self.validate_files(scope, ids)
        if kind != FileKind.IMAGE:
            return FileModelInput(text=text) if text else FileModelInput(reason=error or "file type is unsupported")
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
