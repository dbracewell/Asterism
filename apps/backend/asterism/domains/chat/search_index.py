import uuid
from collections.abc import Sequence
from typing import Protocol

from sqlalchemy import Select, String, Uuid, column, literal_column, select, table, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession


def _reindex_chat(chat_id: str, only_if: str = "1") -> str:
    """SQL that rebuilds one chat's row (title plus all message text) in ``chat_search``.

    Args:
        chat_id: Trigger expression naming the chat (``new.id``, ``old.chat_id``, ...).
        only_if: Extra condition; when false, both statements touch nothing.
    """
    return (
        f"DELETE FROM chat_search WHERE chat_id = {chat_id} AND ({only_if}); "
        "INSERT INTO chat_search(chat_id, user_id, title, content) "
        "SELECT chats.id, chats.user_id, coalesce(chats.title, ''), "
        "coalesce(group_concat(messages.content, ' '), '') FROM chats "
        f"LEFT JOIN messages ON messages.chat_id = chats.id WHERE chats.id = {chat_id} AND ({only_if}) "
        "GROUP BY chats.id; "
    )


_SEARCH_TABLES = (
    "CREATE VIRTUAL TABLE IF NOT EXISTS chat_search USING fts5(chat_id UNINDEXED, user_id UNINDEXED, title, content)",
    "CREATE VIRTUAL TABLE IF NOT EXISTS project_search USING fts5("
    "project_id UNINDEXED, user_id UNINDEXED, name, description)",
)

# Each chat has one row holding its title and all message text, so any message
# change rebuilds that chat's row. Triggers skip work that cannot change it.
_SEARCH_TRIGGERS = {
    "chat_search_chats_ai": "AFTER INSERT ON chats BEGIN "
    "INSERT INTO chat_search(chat_id, user_id, title, content) "
    "VALUES (new.id, new.user_id, coalesce(new.title, ''), ''); END",
    "chat_search_chats_au": f"AFTER UPDATE OF title ON chats BEGIN {_reindex_chat('new.id')}END",
    "chat_search_chats_ad": "AFTER DELETE ON chats BEGIN DELETE FROM chat_search WHERE chat_id = old.id; END",
    "chat_search_messages_ai": f"AFTER INSERT ON messages BEGIN {_reindex_chat('new.chat_id')}END",
    # Writes that leave content and chat unchanged (status, tokens, ...) skip
    # the rebuild; a message moved between chats rebuilds both.
    "chat_search_messages_au": "AFTER UPDATE OF content, chat_id ON messages "
    "WHEN old.content IS NOT new.content OR old.chat_id IS NOT new.chat_id BEGIN "
    f"{_reindex_chat('new.chat_id')}"
    f"{_reindex_chat('old.chat_id', only_if='old.chat_id IS NOT new.chat_id')}END",
    # A chat delete cascades to its messages after the chat row is gone; the
    # chat trigger already dropped its index row, so per-message rebuilds skip.
    "chat_search_messages_ad": "AFTER DELETE ON messages "
    "WHEN EXISTS (SELECT 1 FROM chats WHERE id = old.chat_id) BEGIN "
    f"{_reindex_chat('old.chat_id')}END",
    "project_search_ai": "AFTER INSERT ON projects BEGIN "
    "INSERT INTO project_search(project_id, user_id, name, description) "
    "VALUES (new.id, new.user_id, new.name, new.description); END",
    "project_search_au": "AFTER UPDATE OF name, description ON projects BEGIN "
    "DELETE FROM project_search WHERE project_id = new.id; "
    "INSERT INTO project_search(project_id, user_id, name, description) "
    "VALUES (new.id, new.user_id, new.name, new.description); END",
    "project_search_ad": "AFTER DELETE ON projects BEGIN DELETE FROM project_search WHERE project_id = old.id; END",
}


async def initialize_search_index(connection: AsyncConnection) -> None:
    """Install the current SQLite FTS5 tables and change triggers after model tables exist.

    Databases get these objects from migrations (ADR-0069), not from this
    function. It is the current definition, used by tests that build a schema
    with ``create_all``; the schema parity test checks that the migration head
    matches it, so a change here needs a migration. Triggers are dropped and
    recreated each time.
    """
    if connection.dialect.name != "sqlite":
        raise RuntimeError(f"No full-text search setup for database dialect: {connection.dialect.name}")

    for statement in _SEARCH_TABLES:
        await connection.execute(text(statement))
    for name, body in _SEARCH_TRIGGERS.items():
        await connection.execute(text(f"DROP TRIGGER IF EXISTS {name}"))
        await connection.execute(text(f"CREATE TRIGGER {name} {body}"))


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
