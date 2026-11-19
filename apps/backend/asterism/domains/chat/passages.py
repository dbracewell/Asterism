"""The source page's passage: one cited chunk of a file in the chat's live scope (US-90.4)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import NotFoundException
from asterism.domains.knowledge.vector_store import VectorStore

from .citation_schemas import ChatFilePassage
from .scope import require_chat_file

GONE = "This passage is no longer in the file. It may have been updated since."


async def read_scoped_passage(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    file_id: uuid.UUID,
    chunk_id: str,
    vectors: VectorStore,
    session: AsyncSession,
) -> ChatFilePassage:
    """The chunk's text and place in its file, after the chat's live file-scope check.

    Raises:
        NotFoundException: The file is outside the chat's scope, or the chunk
            no longer exists (the file was re-processed or removed).
    """
    await require_chat_file(user_id=user_id, chat_id=chat_id, file_id=file_id, session=session)
    chunk = await vectors.get_chunk(user_id=user_id, file_id=str(file_id), chunk_id=chunk_id)
    if chunk is None:
        raise NotFoundException(GONE)
    total = await vectors.count_file_chunks(
        user_id=user_id, file_id=str(file_id), artifact_generation=chunk.artifact_generation
    )
    position = chunk.chunk_ordinal + 1
    return ChatFilePassage(
        chunk_id=chunk.id,
        kind=chunk.kind,
        position=position,
        total=max(total, position),
        text=chunk.content,
    )
