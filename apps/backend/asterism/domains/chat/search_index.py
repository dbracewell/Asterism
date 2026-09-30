import uuid
from collections.abc import Sequence
from typing import Protocol

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession


async def initialize_search_index(connection: AsyncConnection) -> None:
    """Install SQLite FTS5 tables and change triggers after model tables exist."""
    if connection.dialect.name != "sqlite":
        raise RuntimeError(f"No full-text search setup for database dialect: {connection.dialect.name}")

    for statement in (
        "CREATE VIRTUAL TABLE IF NOT EXISTS chat_search USING fts5("
        "chat_id UNINDEXED, user_id UNINDEXED, title, content)",
        "CREATE VIRTUAL TABLE IF NOT EXISTS folder_search USING fts5("
        "folder_id UNINDEXED, user_id UNINDEXED, title)",
        "CREATE TRIGGER IF NOT EXISTS chat_search_chats_ai AFTER INSERT ON chats BEGIN "
        "INSERT INTO chat_search(chat_id, user_id, title, content) "
        "VALUES (new.id, new.user_id, coalesce(new.title, ''), ''); END",
        "CREATE TRIGGER IF NOT EXISTS chat_search_chats_au AFTER UPDATE OF title ON chats BEGIN "
        "DELETE FROM chat_search WHERE chat_id = new.id; "
        "INSERT INTO chat_search(chat_id, user_id, title, content) "
        "SELECT chats.id, chats.user_id, coalesce(chats.title, ''), "
        "coalesce(group_concat(messages.content, ' '), '') FROM chats "
        "LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = new.id; END",
        "CREATE TRIGGER IF NOT EXISTS chat_search_chats_ad AFTER DELETE ON chats BEGIN "
        "DELETE FROM chat_search WHERE chat_id = old.id; END",
        "CREATE TRIGGER IF NOT EXISTS chat_search_messages_ai AFTER INSERT ON messages BEGIN "
        "DELETE FROM chat_search WHERE chat_id = new.chat_id; "
        "INSERT INTO chat_search(chat_id, user_id, title, content) "
        "SELECT chats.id, chats.user_id, coalesce(chats.title, ''), "
        "coalesce(group_concat(messages.content, ' '), '') FROM chats "
        "LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = new.chat_id; END",
        "CREATE TRIGGER IF NOT EXISTS chat_search_messages_au AFTER UPDATE OF content ON messages BEGIN "
        "DELETE FROM chat_search WHERE chat_id = new.chat_id; "
        "INSERT INTO chat_search(chat_id, user_id, title, content) "
        "SELECT chats.id, chats.user_id, coalesce(chats.title, ''), "
        "coalesce(group_concat(messages.content, ' '), '') FROM chats "
        "LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = new.chat_id; END",
        "CREATE TRIGGER IF NOT EXISTS chat_search_messages_ad AFTER DELETE ON messages BEGIN "
        "DELETE FROM chat_search WHERE chat_id = old.chat_id; "
        "INSERT INTO chat_search(chat_id, user_id, title, content) "
        "SELECT chats.id, chats.user_id, coalesce(chats.title, ''), "
        "coalesce(group_concat(messages.content, ' '), '') FROM chats "
        "LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = old.chat_id; END",
        "CREATE TRIGGER IF NOT EXISTS folder_search_ai AFTER INSERT ON folders BEGIN "
        "INSERT INTO folder_search(folder_id, user_id, title) VALUES (new.id, new.user_id, new.title); END",
        "CREATE TRIGGER IF NOT EXISTS folder_search_au AFTER UPDATE OF title ON folders BEGIN "
        "DELETE FROM folder_search WHERE folder_id = new.id; "
        "INSERT INTO folder_search(folder_id, user_id, title) VALUES (new.id, new.user_id, new.title); END",
        "CREATE TRIGGER IF NOT EXISTS folder_search_ad AFTER DELETE ON folders BEGIN "
        "DELETE FROM folder_search WHERE folder_id = old.id; END",
    ):
        await connection.execute(text(statement))


class ChatSearchIndex(Protocol):
    async def find_chat_ids(self, user_id: str, terms: Sequence[str]) -> list[uuid.UUID]: ...
    async def find_folder_ids(self, user_id: str, terms: Sequence[str]) -> set[uuid.UUID]: ...


def _fts_query(terms: Sequence[str]) -> str:
    return " AND ".join(f'"{term}"' for term in terms)


class SqliteFtsSearchIndex:
    """SQLite adapter for the database-neutral chat search contract."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def find_chat_ids(self, user_id: str, terms: Sequence[str]) -> list[uuid.UUID]:
        result = await self.session.scalars(
            text("SELECT chat_id FROM chat_search WHERE user_id = :user_id AND chat_search MATCH :query"),
            {"user_id": user_id, "query": _fts_query(terms)},
        )
        return [uuid.UUID(value) for value in result.all()]

    async def find_folder_ids(self, user_id: str, terms: Sequence[str]) -> set[uuid.UUID]:
        result = await self.session.scalars(
            text("SELECT folder_id FROM folder_search WHERE user_id = :user_id AND folder_search MATCH :query"),
            {"user_id": user_id, "query": _fts_query(terms)},
        )
        return {uuid.UUID(value) for value in result.all()}


def search_index_for(session: AsyncSession) -> ChatSearchIndex:
    """Return the adapter for the active database dialect."""
    if session.bind is None or session.bind.dialect.name != "sqlite":
        raise RuntimeError("No full-text search adapter is configured for this database dialect")
    return SqliteFtsSearchIndex(session)
