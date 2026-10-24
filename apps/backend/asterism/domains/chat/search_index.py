import uuid
from collections.abc import Sequence
from typing import Protocol

from sqlalchemy import Select, String, Uuid, column, literal_column, select, table, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession


async def initialize_search_index(connection: AsyncConnection) -> None:
    """Install SQLite FTS5 tables and change triggers after model tables exist."""
    if connection.dialect.name != "sqlite":
        raise RuntimeError(f"No full-text search setup for database dialect: {connection.dialect.name}")

    for statement in (
        "CREATE VIRTUAL TABLE IF NOT EXISTS chat_search USING fts5("
        "chat_id UNINDEXED, user_id UNINDEXED, title, content)",
        "CREATE VIRTUAL TABLE IF NOT EXISTS project_search USING fts5("
        "project_id UNINDEXED, user_id UNINDEXED, name, description)",
        "CREATE TRIGGER IF NOT EXISTS chat_search_chats_ai AFTER INSERT ON chats BEGIN "
        "INSERT INTO chat_search(chat_id, user_id, title, content) "
        "VALUES (new.id, new.user_id, coalesce(new.title, ''), ''); END",
        "CREATE TRIGGER IF NOT EXISTS chat_search_chats_au AFTER UPDATE OF title ON chats BEGIN "
        "DELETE FROM chat_search WHERE chat_id = new.id; "
        "INSERT INTO chat_search(chat_id, user_id, title, content) "
        "SELECT chats.id, chats.user_id, coalesce(chats.title, ''), "
        "coalesce(group_concat(messages.content, ' '), '') FROM chats "
        "LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = new.id "
        "GROUP BY chats.id; END",
        "CREATE TRIGGER IF NOT EXISTS chat_search_chats_ad AFTER DELETE ON chats BEGIN "
        "DELETE FROM chat_search WHERE chat_id = old.id; END",
        "CREATE TRIGGER IF NOT EXISTS chat_search_messages_ai AFTER INSERT ON messages BEGIN "
        "DELETE FROM chat_search WHERE chat_id = new.chat_id; "
        "INSERT INTO chat_search(chat_id, user_id, title, content) "
        "SELECT chats.id, chats.user_id, coalesce(chats.title, ''), "
        "coalesce(group_concat(messages.content, ' '), '') FROM chats "
        "LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = new.chat_id "
        "GROUP BY chats.id; END",
        "CREATE TRIGGER IF NOT EXISTS chat_search_messages_au AFTER UPDATE OF content ON messages BEGIN "
        "DELETE FROM chat_search WHERE chat_id = new.chat_id; "
        "INSERT INTO chat_search(chat_id, user_id, title, content) "
        "SELECT chats.id, chats.user_id, coalesce(chats.title, ''), "
        "coalesce(group_concat(messages.content, ' '), '') FROM chats "
        "LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = new.chat_id "
        "GROUP BY chats.id; END",
        "CREATE TRIGGER IF NOT EXISTS chat_search_messages_ad AFTER DELETE ON messages BEGIN "
        "DELETE FROM chat_search WHERE chat_id = old.chat_id; "
        "INSERT INTO chat_search(chat_id, user_id, title, content) "
        "SELECT chats.id, chats.user_id, coalesce(chats.title, ''), "
        "coalesce(group_concat(messages.content, ' '), '') FROM chats "
        "LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = old.chat_id "
        "GROUP BY chats.id; END",
        "CREATE TRIGGER IF NOT EXISTS project_search_ai AFTER INSERT ON projects BEGIN "
        "INSERT INTO project_search(project_id, user_id, name, description) "
        "VALUES (new.id, new.user_id, new.name, new.description); END",
        "CREATE TRIGGER IF NOT EXISTS project_search_au AFTER UPDATE OF name, description ON projects BEGIN "
        "DELETE FROM project_search WHERE project_id = new.id; "
        "INSERT INTO project_search(project_id, user_id, name, description) "
        "VALUES (new.id, new.user_id, new.name, new.description); END",
        "CREATE TRIGGER IF NOT EXISTS project_search_ad AFTER DELETE ON projects BEGIN "
        "DELETE FROM project_search WHERE project_id = old.id; END",
    ):
        await connection.execute(text(statement))


class ChatSearchIndex(Protocol):
    """SQL ID relations composed into owned domain queries, never executed alone."""

    def matching_chats(self, user_id: str, terms: Sequence[str]) -> Select[tuple[uuid.UUID]]: ...
    def matching_projects(self, user_id: str, terms: Sequence[str]) -> Select[tuple[uuid.UUID]]: ...


def _fts_query(terms: Sequence[str]) -> str:
    return " AND ".join(f'"{term}"' for term in terms)


class SqliteFtsSearchIndex:
    """Keep SQLite MATCH syntax behind composable, typed SQL ID relations."""

    def matching_chats(self, user_id: str, terms: Sequence[str]) -> Select[tuple[uuid.UUID]]:
        index = table("chat_search", column("chat_id", Uuid()), column("user_id", String()))
        return select(index.c.chat_id).where(
            index.c.user_id == user_id,
            literal_column("chat_search").match(_fts_query(terms)),
        )

    def matching_projects(self, user_id: str, terms: Sequence[str]) -> Select[tuple[uuid.UUID]]:
        index = table("project_search", column("project_id", Uuid()), column("user_id", String()))
        return select(index.c.project_id).where(
            index.c.user_id == user_id,
            literal_column("project_search").match(_fts_query(terms)),
        )


def search_index_for(session: AsyncSession) -> ChatSearchIndex:
    """Return the adapter for the active database dialect."""
    if session.bind is None or session.bind.dialect.name != "sqlite":
        raise RuntimeError("No full-text search adapter is configured for this database dialect")
    return SqliteFtsSearchIndex()
