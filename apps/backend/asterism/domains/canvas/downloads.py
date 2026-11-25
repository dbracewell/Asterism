"""Download a canvas version, a chat's canvas as a ZIP, or save a version to the library."""

import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import NotFoundException

from . import service
from .branches import active_branch
from .exports import (
    FORMATS,
    MEDIA_TYPES,
    CanvasExportFormat,
    Diagrams,
    ExportedFile,
    export_version,
    file_stem,
    mermaid_sources,
    zip_exports,
)

logger = get_logger("Canvas")

# ADR-0082: per export, at most this many diagrams are drawn, within this time;
# the rest export as code with a note.
MAX_EXPORT_DIAGRAMS = 30
EXPORT_DIAGRAM_SECONDS = 60.0


async def draw_export_diagrams(content: str) -> Diagrams:
    """Pictures for the document's mermaid fences, keyed by source."""
    from .diagrams import draw_diagrams

    sources = mermaid_sources(content)[:MAX_EXPORT_DIAGRAMS]
    if not sources:
        return {}
    drawn = await draw_diagrams(sources, deadline_seconds=EXPORT_DIAGRAM_SECONDS)
    return dict(zip(sources, drawn, strict=True))


async def export_item_version(
    user_id: str,
    chat_id: uuid.UUID,
    item_id: uuid.UUID,
    number: int,
    export: CanvasExportFormat,
    session: AsyncSession,
) -> ExportedFile:
    """One version visible on the chat's active branch, as ``export``."""
    branch = await active_branch(user_id, chat_id, session)
    version = service.full_version(await service.visible_item(user_id, chat_id, item_id, branch, session), number)
    # DOCX and PDF show mermaid fences as drawn diagrams; other formats keep
    # the source.
    diagrams = await draw_export_diagrams(version.content) if export in ("docx", "pdf") else None
    # DOCX and PDF layout is CPU work; keep it off the event loop.
    return await asyncio.to_thread(
        export_version,
        kind=version.kind,
        language=version.language,
        title=version.title,
        content=version.content,
        export=export,
        diagrams=diagrams,
    )


async def export_chat(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> ExportedFile:
    """Every item visible on the active branch, at its current version, in its natural file type."""
    from asterism.domains.chat.models import ChatModel
    from asterism.domains.chat.queries import select_owned_chats

    title = await session.scalar(
        select_owned_chats(user_id=user_id).with_only_columns(ChatModel.title).where(ChatModel.id == chat_id)
    )
    branch = await active_branch(user_id, chat_id, session)
    entries = await service.visible_items(user_id, chat_id, branch, session)
    if not entries:
        raise NotFoundException("This conversation has no canvas items")
    files = [
        export_version(
            kind=entry.item.kind,
            language=entry.item.language,
            title=entry.current.title,
            content=entry.current.content,
            export=FORMATS[entry.item.kind][0],
        )
        for entry in entries
    ]
    return ExportedFile(
        filename=f"{file_stem(title or 'Canvas')}.zip",
        media_type=MEDIA_TYPES["zip"],
        content=zip_exports(files),
    )


async def save_to_library(
    user_id: str,
    chat_id: uuid.UUID,
    item_id: uuid.UUID,
    number: int,
    export: CanvasExportFormat,
    session: AsyncSession,
):
    """Add the exported version to the user's file library, then queue its knowledge processing."""
    from asterism.domains.files.listing import describe_files
    from asterism.domains.files.service import new_library_file, start_file_ingestion
    from asterism.domains.files.store import get_file_store

    exported = await export_item_version(user_id, chat_id, item_id, number, export, session)
    created = await new_library_file(
        user_id=user_id, original_name=exported.filename, content=exported.content, session=session
    )
    try:
        await session.commit()
    except (Exception, asyncio.CancelledError):
        await session.rollback()
        get_file_store().delete(user_id, created.storage_key)
        raise
    start_file_ingestion(created)
    logger.info(f"User {user_id} saved canvas item {item_id} version {number} to the library as {created.model.id}")
    return (await describe_files(user_id=user_id, files=[created.model], session=session))[0]
