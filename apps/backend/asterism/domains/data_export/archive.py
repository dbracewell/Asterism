"""Write one person's data into a zip archive (US-86.8).

Layout, inside one top folder:

- ``README.md``: what is where.
- ``account.json``, ``settings.json``, ``about-you.md``.
- ``memories.json``: every saved memory, user and project, with ``sensitive``.
- ``chats/<date> <title> (<id>)/chat.md``: the branch shown in the app, readable.
  ``chat.json`` next to it has the chat and every message on every branch.
  ``canvas/`` holds the chat's canvas items at their current version.
- ``skills/<name>.md``: each skill's SKILL.md text.
- ``files/``: the library files as uploaded or produced.
- ``records/<table>.json``: projects, study records, reflections, usage and the
  rest, one JSON object per row (see ``records.RECORD_TABLES``).
"""

import asyncio
import json
import re
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.domains.canvas import service as canvas_service
from asterism.domains.canvas.branches import active_branch as canvas_branch
from asterism.domains.canvas.exports import FORMATS, export_version
from asterism.domains.canvas.queries import select_owned_versions
from asterism.domains.chat.branches import active_branch
from asterism.domains.chat.models import ChatModel
from asterism.domains.chat.queries import select_owned_chats, select_owned_messages
from asterism.domains.chat.schemas import Message
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.store import get_file_store
from asterism.domains.groups.service import read_group_refs
from asterism.domains.memory.queries import order_memories, select_owned_memories
from asterism.domains.memory.service import to_memory
from asterism.domains.skills.models import SkillModel
from asterism.domains.user.models import UserModel

from .records import RECORD_TABLES, owned_rows, row_json

logger = get_logger("DataExport")

ROLE_LABELS = {"user": "You", "assistant": "Assistant"}

README = """# Your Asterism data

Exported {exported}. Times are UTC.

- `account.json`: your name, email, group and account dates.
- `settings.json`: your settings, main agent and sub-agent definitions.
- `about-you.md`: your About you text.
- `memories.json`: what Asterism remembers about you and your projects. A
  memory with `"sensitive": true` is one you or Asterism marked sensitive.
- `chats/`: one folder per chat. `chat.md` is the conversation as shown in the
  app; `chat.json` has every message on every branch, with its sources,
  citations and tool calls. `canvas/` holds the chat's canvas documents.
- `skills/`: your skills as SKILL.md text.
- `files/`: your library files, as uploaded or produced.
- `records/`: projects, study decks, cards, reviews, quizzes and notes,
  reflections, prompt templates, image requests, memory offers and the
  memories each reply used, usage, class memberships and other records, one
  JSON object per row.

Files in `files/` are named as in your library. Records refer to each other
by id.
"""


def safe_name(text: str, fallback: str) -> str:
    """A single path segment: no separators, control characters or leading dots."""
    name = re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]+', " ", text)
    name = " ".join(name.split()).lstrip(".").strip()[:80].rstrip(". ")
    return name or fallback


def utc(timestamp: int | None) -> str:
    if timestamp is None:
        return ""
    return datetime.fromtimestamp(timestamp, UTC).strftime("%Y-%m-%d %H:%M")


def chat_markdown(chat: ChatModel, messages: list[Message]) -> str:
    """The active branch as a readable conversation."""
    lines = [f"# {chat.title or 'Untitled chat'}", "", f"Started {utc(chat.created_at)} UTC.", ""]
    for message in messages:
        if message.role not in ROLE_LABELS:
            continue
        lines += [f"## {ROLE_LABELS[message.role]} · {utc(message.created_at)}", "", message.content.rstrip(), ""]
    return "\n".join(lines)


class ArchiveWriter:
    """A zip under one top folder; names repeated within a folder get ``(2)``, ``(3)``…"""

    def __init__(self, path: Path, top: str):
        self.zip = zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True)
        self.top = top
        self.names: set[str] = set()

    def unique(self, folder: str, name: str) -> str:
        stem, dot, suffix = name.rpartition(".")
        if not dot or not stem:
            stem, suffix = name, ""
        candidate, number = name, 1
        while f"{folder}/{candidate}".lower() in self.names:
            number += 1
            candidate = f"{stem} ({number}).{suffix}" if suffix else f"{stem} ({number})"
        self.names.add(f"{folder}/{candidate}".lower())
        return f"{self.top}/{folder}/{candidate}" if folder else f"{self.top}/{candidate}"

    def text(self, folder: str, name: str, content: str) -> None:
        self.zip.writestr(self.unique(folder, name), content.encode("utf-8"))

    def json(self, folder: str, name: str, value: Any) -> None:
        self.text(folder, name, json.dumps(value, ensure_ascii=False, indent=2) + "\n")

    async def file(self, folder: str, name: str, source: Path) -> None:
        # Large library files are compressed off the event loop.
        await asyncio.to_thread(self.zip.write, source, self.unique(folder, name))

    def close(self) -> None:
        self.zip.close()


async def _account(writer: ArchiveWriter, user_id: str, session: AsyncSession) -> None:
    user = await session.get(UserModel, user_id)
    if user is None:
        raise LookupError("The account no longer exists")
    group = (await read_group_refs([user_id], session)).get(user_id)
    writer.json(
        "",
        "account.json",
        {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "created_at": user.created_at,
            "group": group.model_dump(mode="json") if group else None,
            "suspended_at": user.suspended_at,
        },
    )
    writer.text("", "about-you.md", user.about_md)


async def _settings(writer: ArchiveWriter, user_id: str, session: AsyncSession) -> None:
    from asterism.domains.settings.service import get_user_settings

    settings = await get_user_settings(user_id, session)
    # The model list is the instance's catalog, not the person's data.
    writer.json("", "settings.json", settings.model_dump(mode="json", exclude={"models"}))


async def _memories(writer: ArchiveWriter, user_id: str, session: AsyncSession) -> None:
    rows = (await session.scalars(order_memories(select_owned_memories(user_id)))).all()
    writer.json("", "memories.json", [to_memory(row).model_dump(mode="json") for row in rows])


async def _canvases(writer: ArchiveWriter, folder: str, user_id: str, chat: ChatModel, session: AsyncSession) -> list:
    versions = (await session.scalars(select_owned_versions(user_id=user_id, chat_id=chat.id))).all()
    if not versions:
        return []
    branch = await canvas_branch(user_id, chat.id, session)
    for entry in await canvas_service.visible_items(user_id, chat.id, branch, session):
        exported = export_version(
            kind=entry.item.kind,
            language=entry.item.language,
            title=entry.current.title,
            content=entry.current.content,
            export=FORMATS[entry.item.kind][0],
        )
        writer.zip.writestr(writer.unique(f"{folder}/canvas", safe_name(exported.filename, "canvas")), exported.content)
    return [row_json(version) for version in versions]


async def _chats(writer: ArchiveWriter, user_id: str, session: AsyncSession) -> None:
    chats = (await session.scalars(select_owned_chats(user_id=user_id))).all()
    for chat in chats:
        records = (await session.scalars(select_owned_messages(user_id=user_id, chat_id=chat.id))).all()
        records = sorted(records, key=lambda record: (record.created_at, str(record.id)))
        date = utc(chat.created_at)[:10]
        folder = "chats/" + safe_name(f"{date} {chat.title or 'Untitled chat'} ({str(chat.id)[:8]})", str(chat.id))
        writer.text(folder, "chat.md", chat_markdown(chat, active_branch(records, chat.active_root_id)))
        writer.json(
            folder,
            "chat.json",
            {
                "chat": row_json(chat),
                "messages": [row_json(record) for record in records],
                "canvas_versions": await _canvases(writer, folder, user_id, chat, session),
            },
        )
        # Release this chat's rows before the next one is loaded.
        session.expunge_all()


async def _skills(writer: ArchiveWriter, user_id: str, session: AsyncSession) -> None:
    skills = (await session.scalars(select(SkillModel).where(SkillModel.user_id == user_id))).all()
    for skill in skills:
        writer.text("skills", f"{safe_name(skill.name, 'skill')}.md", skill.content)


async def _files(writer: ArchiveWriter, user_id: str, session: AsyncSession) -> None:
    store = get_file_store()
    files = (
        await session.scalars(
            select(UserFileModel).where(UserFileModel.user_id == user_id).order_by(UserFileModel.filename)
        )
    ).all()
    for file in files:
        if not await store.exists(user_id, file.storage_key):
            logger.warning("A library file's source is missing; left out of the archive")
            continue
        await writer.file("files", safe_name(file.filename, "file"), store.local_path(user_id, file.storage_key))


async def _records(writer: ArchiveWriter, user_id: str, session: AsyncSession) -> None:
    for table in RECORD_TABLES:
        target = writer.unique("records", f"{table.name}.json")
        with writer.zip.open(target, "w") as stream:
            stream.write(b"[")
            first = True
            async for row in owned_rows(table, user_id, session):
                stream.write((b"\n  " if first else b",\n  ") + json.dumps(row, ensure_ascii=False).encode("utf-8"))
                first = False
            stream.write(b"\n]\n" if not first else b"]\n")


async def build_archive(user_id: str, destination: Path, session: AsyncSession, now: datetime) -> None:
    """Write the person's archive to ``destination``."""
    top = f"asterism-data-{now.strftime('%Y-%m-%d')}"
    writer = ArchiveWriter(destination, top)
    try:
        writer.text("", "README.md", README.format(exported=now.strftime("%Y-%m-%d %H:%M UTC")))
        await _account(writer, user_id, session)
        await _settings(writer, user_id, session)
        await _memories(writer, user_id, session)
        await _skills(writer, user_id, session)
        await _chats(writer, user_id, session)
        await _files(writer, user_id, session)
        await _records(writer, user_id, session)
    finally:
        writer.close()
