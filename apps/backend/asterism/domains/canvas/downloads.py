"""Download a canvas version, a chat's canvas as a ZIP, or save a version to the library."""

import asyncio
import io
import uuid
from pathlib import Path

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
    ExportImage,
    Images,
    export_version,
    file_stem,
    image_note,
    image_references,
    mermaid_sources,
    rewrite_file_references,
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


# ADR-0083: per export, at most this many chat images are included, each at
# most this size; larger or extra images are written as a note.
MAX_EXPORT_IMAGES = 32
MAX_EXPORT_IMAGE_BYTES = 20 * 1024 * 1024
# Decoded size limit, against images that are small files but huge bitmaps.
MAX_EXPORT_IMAGE_PIXELS = 40_000_000
# Raster types only: an SVG is written as a note.
EXPORT_IMAGE_TYPES = {
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def _decode(data: bytes, name: str, extension: str) -> ExportImage | None:
    """The image re-encoded as PNG (the first frame of an animation), or ``None``."""
    from PIL import Image

    try:
        with Image.open(io.BytesIO(data)) as opened:
            if opened.width * opened.height > MAX_EXPORT_IMAGE_PIXELS:
                return None
            opened.seek(0)
            frame = opened.convert("RGBA" if "A" in opened.getbands() or "transparency" in opened.info else "RGB")
            buffer = io.BytesIO()
            frame.save(buffer, format="PNG")
            return ExportImage(
                png=buffer.getvalue(),
                width=frame.width,
                height=frame.height,
                name=name,
                original=data,
                extension=extension,
            )
    except Exception:
        return None


async def load_export_images(user_id: str, chat_id: uuid.UUID, contents: list[str], session: AsyncSession) -> Images:
    """The chat images the documents reference, keyed by file id (ADR-0083).

    Only ``![…](asterism-file:<id>)`` images in the chat's live file scope are
    read, through the owner's file records and the file store, up to the
    export's limits. Anything else, including an image that can't be decoded,
    is left out and exported as a note. Logs name file ids, never content.
    """
    from asterism.domains.chat.inline_files import read_live_file_ids
    from asterism.domains.files.models import UserFileModel
    from asterism.domains.files.queries import select_owned_files
    from asterism.domains.files.store import get_file_store

    ids = list(dict.fromkeys(file_id for content in contents for file_id in image_references(content)))
    if not ids:
        return {}
    live = await read_live_file_ids(user_id=user_id, chat_id=chat_id, session=session)
    wanted = [file_id for file_id in ids if file_id in live][:MAX_EXPORT_IMAGES]
    if not wanted:
        return {}
    files = {
        file.id: file
        for file in await session.scalars(select_owned_files(user_id=user_id).where(UserFileModel.id.in_(wanted)))
    }
    store = get_file_store()
    images: dict[uuid.UUID, ExportImage] = {}
    for file_id in wanted:
        file = files.get(file_id)
        extension = EXPORT_IMAGE_TYPES.get(file.mime_type or "") if file else None
        if file is None or extension is None or (file.size or 0) > MAX_EXPORT_IMAGE_BYTES:
            continue
        try:
            data = await store.read_bytes(user_id, file.storage_key, limit=MAX_EXPORT_IMAGE_BYTES + 1)
        except Exception as exc:
            logger.warning(f"Canvas export left out image {file_id} ({type(exc).__name__})")
            continue
        if len(data) > MAX_EXPORT_IMAGE_BYTES:
            continue
        image = await asyncio.to_thread(_decode, data, file.original_name or "image", extension)
        if image is not None:
            images[file_id] = image
    logger.info(f"Canvas export included {len(images)} of {len(ids)} referenced images")
    return images


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
    # DOCX and PDF embed the document's chat images; Markdown and text write
    # each image's description instead (ADR-0083).
    images = None
    if version.kind == "document":
        documents = [version.content] if export in ("docx", "pdf") else []
        images = await load_export_images(user_id, chat_id, documents, session)
    # DOCX and PDF layout is CPU work; keep it off the event loop.
    return await asyncio.to_thread(
        export_version,
        kind=version.kind,
        language=version.language,
        title=version.title,
        content=version.content,
        export=export,
        diagrams=diagrams,
        images=images,
    )


def _zip_image_names(images: Images) -> dict[uuid.UUID, str]:
    """A distinct ``images/<name>.<ext>`` path for each image."""
    names: dict[uuid.UUID, str] = {}
    taken: set[str] = set()
    for file_id, image in images.items():
        stem, counter = file_stem(Path(image.name).stem or "image"), 2
        name = f"images/{stem}.{image.extension}"
        while name.lower() in taken:
            name = f"images/{stem} ({counter}).{image.extension}"
            counter += 1
        taken.add(name.lower())
        names[file_id] = name
    return names


def _zip_document(content: str, names: dict[uuid.UUID, str]) -> str:
    """Images point into the ZIP's ``images/`` folder; the rest become notes."""
    from urllib.parse import quote

    def image(file_id: uuid.UUID, alt: str) -> str:
        name = names.get(file_id)
        return f"![{alt}]({quote(name, safe='/')})" if name else f"[{image_note(alt)}]"

    return rewrite_file_references(content, image)


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
    documents = [entry.current.content for entry in entries if entry.item.kind == "document"]
    images = await load_export_images(user_id, chat_id, documents, session)
    names = _zip_image_names(images)
    files = [
        export_version(
            kind=entry.item.kind,
            language=entry.item.language,
            title=entry.current.title,
            content=(
                _zip_document(entry.current.content, names) if entry.item.kind == "document" else entry.current.content
            ),
            export=FORMATS[entry.item.kind][0],
        )
        for entry in entries
    ]
    pictures = [
        ExportedFile(filename=names[file_id], media_type="application/octet-stream", content=image.original)
        for file_id, image in images.items()
    ]
    return ExportedFile(
        filename=f"{file_stem(title or 'Canvas')}.zip",
        media_type=MEDIA_TYPES["zip"],
        content=zip_exports(files + pictures),
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
