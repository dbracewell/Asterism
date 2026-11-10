"""Canvas lifecycle: create items, add immutable versions, read by branch (ADR-0063)."""

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException

from .branches import Branch, is_visible
from .models import CanvasItemModel, CanvasVersionModel
from .queries import select_owned_items, select_owned_versions
from .schemas import (
    MAX_CONTENT_BYTES,
    MAX_EDITS,
    MAX_ITEMS_PER_CHAT,
    MAX_TITLE_LENGTH,
    MAX_VERSIONS_PER_ITEM,
    CanvasAuthor,
    CanvasItemHistory,
    CanvasItemSummary,
    CanvasKind,
    CanvasVersion,
    CanvasVersionSummary,
)

logger = get_logger("Canvas")
LANGUAGE = re.compile(r"^[a-z0-9][a-z0-9+#._-]{0,31}$")


@dataclass(frozen=True)
class VisibleItem:
    item: CanvasItemModel
    # Visible versions, oldest first; the last is the item's current version.
    versions: list[CanvasVersionModel]

    @property
    def current(self) -> CanvasVersionModel:
        return self.versions[-1]


@dataclass(frozen=True)
class Anchor:
    """Where a new version sits: its message and, for the agent, its run."""

    author: CanvasAuthor
    message_id: uuid.UUID
    execution_id: uuid.UUID | None


def _size(content: str) -> int:
    return len(content.encode("utf-8"))


def _title(title: str) -> str:
    cleaned = " ".join(title.split())
    if not 1 <= len(cleaned) <= MAX_TITLE_LENGTH:
        raise BadDataException(f"A canvas title needs 1 to {MAX_TITLE_LENGTH} characters")
    return cleaned


def _content(content: str) -> str:
    if _size(content) > MAX_CONTENT_BYTES:
        raise BadDataException(f"Canvas content is limited to {MAX_CONTENT_BYTES} UTF-8 bytes")
    return content


def _language(kind: CanvasKind, language: str | None) -> str:
    value = (language or "").strip().lower()
    if kind != "code":
        return ""
    if not LANGUAGE.match(value):
        raise BadDataException("Code needs a language, such as python or typescript")
    return value


def apply_edits(content: str, edits: list[tuple[str, str]]) -> str:
    """Apply targeted edits in order; each ``find`` must occur exactly once."""
    if not edits or len(edits) > MAX_EDITS:
        raise BadDataException(f"Give 1 to {MAX_EDITS} edits")
    for index, (find, replace) in enumerate(edits, start=1):
        if not find:
            raise BadDataException(f"Edit {index}: the text to find is empty")
        count = content.count(find)
        if count != 1:
            where = "was not found" if count == 0 else f"occurs {count} times; include more context"
            raise BadDataException(f"Edit {index}: the text to find {where}")
        content = content.replace(find, replace, 1)
    return content


async def visible_items(user_id: str, chat_id: uuid.UUID, branch: Branch, session: AsyncSession) -> list[VisibleItem]:
    """Items visible on ``branch`` with their visible versions, oldest item first."""
    items = {
        item.id: item
        for item in await session.scalars(
            select_owned_items(user_id=user_id, chat_id=chat_id).order_by(
                CanvasItemModel.created_at, CanvasItemModel.id
            )
        )
    }
    versions: dict[uuid.UUID, list[CanvasVersionModel]] = {}
    for version in await session.scalars(select_owned_versions(user_id=user_id, chat_id=chat_id)):
        if is_visible(version, branch):
            versions.setdefault(version.item_id, []).append(version)
    return [VisibleItem(item=item, versions=versions[item.id]) for item in items.values() if item.id in versions]


async def visible_item(
    user_id: str, chat_id: uuid.UUID, item_id: uuid.UUID, branch: Branch, session: AsyncSession
) -> VisibleItem:
    found = next(
        (entry for entry in await visible_items(user_id, chat_id, branch, session) if entry.item.id == item_id), None
    )
    if found is None:
        raise NotFoundException("Canvas item not found in this conversation")
    return found


def summary(entry: VisibleItem) -> CanvasItemSummary:
    current = entry.current
    return CanvasItemSummary(
        id=entry.item.id,
        kind=entry.item.kind,
        language=entry.item.language,
        title=current.title,
        version=current.number,
        author=current.author,
        size=_size(current.content),
        updated_at=current.created_at,
    )


def _version_summary(version: CanvasVersionModel) -> CanvasVersionSummary:
    return CanvasVersionSummary(
        number=version.number,
        title=version.title,
        author=version.author,
        message_id=version.message_id,
        size=_size(version.content),
        created_at=version.created_at,
    )


def history(entry: VisibleItem) -> CanvasItemHistory:
    return CanvasItemHistory(
        id=entry.item.id,
        kind=entry.item.kind,
        language=entry.item.language,
        versions=[_version_summary(version) for version in entry.versions],
    )


def full_version(entry: VisibleItem, number: int | None = None) -> CanvasVersion:
    version = entry.current if number is None else next((v for v in entry.versions if v.number == number), None)
    if version is None:
        raise NotFoundException("Canvas version not found in this conversation")
    return CanvasVersion(
        **_version_summary(version).model_dump(),
        item_id=entry.item.id,
        kind=entry.item.kind,
        language=entry.item.language,
        content=version.content,
    )


async def _require_anchor(user_id: str, chat_id: uuid.UUID, anchor: Anchor, branch: Branch) -> None:
    if anchor.message_id not in branch.message_ids:
        raise BadDataException("A canvas version must be anchored to a message on its branch")
    if (anchor.author == "agent") != (anchor.execution_id is not None):
        raise BadDataException("Only agent versions record a run")


async def create_item(
    user_id: str,
    chat_id: uuid.UUID,
    branch: Branch,
    anchor: Anchor,
    *,
    kind: CanvasKind,
    title: str,
    content: str,
    language: str | None,
    session: AsyncSession,
) -> VisibleItem:
    await _require_anchor(user_id, chat_id, anchor, branch)
    count = await session.scalar(
        select_owned_items(user_id=user_id, chat_id=chat_id).with_only_columns(func.count(CanvasItemModel.id))
    )
    if (count or 0) >= MAX_ITEMS_PER_CHAT:
        raise BadDataException(f"A conversation can have at most {MAX_ITEMS_PER_CHAT} canvas items")
    item = CanvasItemModel(user_id=user_id, chat_id=chat_id, kind=kind, language=_language(kind, language))
    session.add(item)
    await session.flush()
    version = CanvasVersionModel(
        item_id=item.id,
        number=1,
        title=_title(title),
        content=_content(content),
        author=anchor.author,
        message_id=anchor.message_id,
        execution_id=anchor.execution_id,
    )
    session.add(version)
    await session.commit()
    logger.info(f"Created canvas item {item.id} in chat {chat_id} for user {user_id}")
    return VisibleItem(item=item, versions=[version])


async def add_version(
    user_id: str,
    chat_id: uuid.UUID,
    item_id: uuid.UUID,
    branch: Branch,
    anchor: Anchor,
    *,
    title: str | None,
    content: str | None = None,
    edits: list[tuple[str, str]] | None = None,
    session: AsyncSession,
) -> VisibleItem:
    """A new version on top of the item's current version on ``branch``."""
    await _require_anchor(user_id, chat_id, anchor, branch)
    if content is not None and edits is not None:
        raise BadDataException("Give either new content or edits, not both")
    if content is None and edits is None and title is None:
        raise BadDataException("Give new content, edits or a title")
    entry = await visible_item(user_id, chat_id, item_id, branch, session)
    base = entry.current
    text = content if content is not None else apply_edits(base.content, edits) if edits else base.content
    numbers = await session.scalars(select(CanvasVersionModel.number).where(CanvasVersionModel.item_id == item_id))
    taken = list(numbers)
    if len(taken) >= MAX_VERSIONS_PER_ITEM:
        raise BadDataException(f"A canvas item can have at most {MAX_VERSIONS_PER_ITEM} versions")
    version = CanvasVersionModel(
        item_id=item_id,
        number=max(taken) + 1,
        title=_title(title) if title is not None else base.title,
        content=_content(text),
        author=anchor.author,
        message_id=anchor.message_id,
        execution_id=anchor.execution_id,
    )
    session.add(version)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictException("The canvas item changed; read it again before updating") from exc
    return VisibleItem(item=entry.item, versions=[*entry.versions, version])


def _user_anchor(branch: Branch) -> Anchor:
    if branch.leaf_id is None:
        raise BadDataException("Send a message before editing the canvas")
    return Anchor(author="user", message_id=branch.leaf_id, execution_id=None)


async def _require_base(
    user_id: str, chat_id: uuid.UUID, item_id: uuid.UUID, branch: Branch, base_version: int, session: AsyncSession
) -> VisibleItem:
    entry = await visible_item(user_id, chat_id, item_id, branch, session)
    if entry.current.number != base_version:
        raise ConflictException(f"The canvas item is now at version {entry.current.number}; reload it before saving")
    return entry


async def save_user_version(
    user_id: str,
    chat_id: uuid.UUID,
    item_id: uuid.UUID,
    branch: Branch,
    *,
    base_version: int,
    title: str | None,
    content: str,
    session: AsyncSession,
) -> VisibleItem:
    """The user's edit, anchored to the branch's last message (ADR-0063)."""
    await _require_base(user_id, chat_id, item_id, branch, base_version, session)
    return await add_version(
        user_id, chat_id, item_id, branch, _user_anchor(branch), title=title, content=content, session=session
    )


async def create_user_item(
    user_id: str,
    chat_id: uuid.UUID,
    branch: Branch,
    *,
    kind: CanvasKind,
    title: str,
    language: str | None,
    content: str,
    session: AsyncSession,
) -> VisibleItem:
    """An item the user starts, anchored like their edits to the branch's last message."""
    return await create_item(
        user_id,
        chat_id,
        branch,
        _user_anchor(branch),
        kind=kind,
        title=title,
        content=content,
        language=language,
        session=session,
    )


async def restore_version(
    user_id: str,
    chat_id: uuid.UUID,
    item_id: uuid.UUID,
    branch: Branch,
    *,
    number: int,
    base_version: int,
    session: AsyncSession,
) -> VisibleItem:
    """A new user version copying an earlier visible version's title and content."""
    entry = await _require_base(user_id, chat_id, item_id, branch, base_version, session)
    source = next((version for version in entry.versions if version.number == number), None)
    if source is None:
        raise NotFoundException("Canvas version not found in this conversation")
    return await add_version(
        user_id,
        chat_id,
        item_id,
        branch,
        _user_anchor(branch),
        title=source.title,
        content=source.content,
        session=session,
    )
