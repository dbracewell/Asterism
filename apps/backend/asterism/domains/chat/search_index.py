import uuid
from collections.abc import Sequence
from typing import Protocol

from sqlalchemy import CompoundSelect, Select, String, Uuid, column, intersect, literal_column, select, table, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

# One index row per message and one per chat title (ADR-0085). ``chat_search_keys``
# gives each row a stable integer key, used as its FTS5 rowid, so a trigger finds
# the one row it changes by index instead of scanning FTS5's unindexed columns.
_TITLE_KEY = "(SELECT id FROM chat_search_keys WHERE chat_id = {chat} AND message_id IS NULL)"
_MESSAGE_KEY = "(SELECT id FROM chat_search_keys WHERE message_id = {message})"

_SEARCH_TABLES = (
    "CREATE TABLE IF NOT EXISTS chat_search_keys (id INTEGER PRIMARY KEY, chat_id CHAR(32) NOT NULL, "
    "message_id CHAR(32) UNIQUE)",
    "CREATE UNIQUE INDEX IF NOT EXISTS chat_search_keys_title ON chat_search_keys (chat_id) WHERE message_id IS NULL",
    "CREATE INDEX IF NOT EXISTS chat_search_keys_chat ON chat_search_keys (chat_id, message_id)",
    "CREATE VIRTUAL TABLE IF NOT EXISTS chat_search USING fts5(chat_id UNINDEXED, user_id UNINDEXED, content)",
    "CREATE VIRTUAL TABLE IF NOT EXISTS project_search USING fts5("
    "project_id UNINDEXED, user_id UNINDEXED, name, description)",
)

_SEARCH_TRIGGERS = {
    "chat_search_chats_ai": "AFTER INSERT ON chats BEGIN "
    "INSERT INTO chat_search_keys (chat_id, message_id) VALUES (new.id, NULL); "
    "INSERT INTO chat_search (rowid, chat_id, user_id, content) "
    f"VALUES ({_TITLE_KEY.format(chat='new.id')}, new.id, new.user_id, coalesce(new.title, '')); END",
    "chat_search_chats_au": "AFTER UPDATE OF title ON chats WHEN old.title IS NOT new.title BEGIN "
    f"UPDATE chat_search SET content = coalesce(new.title, '') WHERE rowid = {_TITLE_KEY.format(chat='new.id')}; "
    "END",
    # A deleted chat drops all its rows by key, so it doesn't rely on the message
    # cascade; the cascaded message deletes then find nothing left to remove.
    "chat_search_chats_ad": "AFTER DELETE ON chats BEGIN "
    "DELETE FROM chat_search WHERE rowid IN (SELECT id FROM chat_search_keys WHERE chat_id = old.id); "
    "DELETE FROM chat_search_keys WHERE chat_id = old.id; END",
    "chat_search_messages_ai": "AFTER INSERT ON messages BEGIN "
    "INSERT INTO chat_search_keys (chat_id, message_id) VALUES (new.chat_id, new.id); "
    "INSERT INTO chat_search (rowid, chat_id, user_id, content) "
    f"SELECT {_MESSAGE_KEY.format(message='new.id')}, chats.id, chats.user_id, coalesce(new.content, '') "
    "FROM chats WHERE chats.id = new.chat_id; END",
    # Writes that leave content and chat unchanged (status, tokens, ...) touch nothing.
    "chat_search_messages_au": "AFTER UPDATE OF content, chat_id ON messages "
    "WHEN old.content IS NOT new.content OR old.chat_id IS NOT new.chat_id BEGIN "
    "UPDATE chat_search_keys SET chat_id = new.chat_id WHERE message_id = new.id; "
    "UPDATE chat_search SET chat_id = new.chat_id, content = coalesce(new.content, ''), "
    "user_id = (SELECT user_id FROM chats WHERE id = new.chat_id) "
    f"WHERE rowid = {_MESSAGE_KEY.format(message='new.id')}; END",
    "chat_search_messages_ad": "AFTER DELETE ON messages BEGIN "
    f"DELETE FROM chat_search WHERE rowid = {_MESSAGE_KEY.format(message='old.id')}; "
    "DELETE FROM chat_search_keys WHERE message_id = old.id; END",
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

    def matching_chats(self, user_id: str, terms: Sequence[str]) -> CompoundSelect | Select[tuple[uuid.UUID]]: ...
    def matching_projects(self, user_id: str, terms: Sequence[str]) -> Select[tuple[uuid.UUID]]: ...


def _fts_query(terms: Sequence[str]) -> str:
    return " AND ".join(f'"{term}"' for term in terms)


class SqliteFtsSearchIndex:
    """Keep SQLite MATCH syntax behind composable, typed SQL ID relations."""

    def matching_chats(self, user_id: str, terms: Sequence[str]) -> CompoundSelect | Select[tuple[uuid.UUID]]:
        """Chats where every term is in the title or some message (rows are per message, ADR-0085)."""
        index = table("chat_search", column("chat_id", Uuid()), column("user_id", String()))
        per_term = [
            select(index.c.chat_id).where(
                index.c.user_id == user_id,
                literal_column("chat_search").match(_fts_query([term])),
            )
            for term in dict.fromkeys(terms)
        ]
        return per_term[0] if len(per_term) == 1 else intersect(*per_term)

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
