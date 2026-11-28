"""One chat search row per message and per title (US-122.1)

Revision ID: 5c38bc190c46
Revises: 2114351c62ff
Create Date: 2026-11-28

Forward-only (ADR-0069): there is no downgrade. ADR-0085 replaces the one
``chat_search`` row per chat (title plus all message text, rebuilt on every
message write) with one row per message and one per chat title. A new
``chat_search_keys`` table gives each row a stable integer key, used as its
FTS5 rowid, so each trigger changes only the row it names.

The old triggers and table are dropped and the index is rebuilt from every
existing chat and message. The SQL is frozen here; ``initialize_search_index``
holds the current definition, and the schema parity test checks they match.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "5c38bc190c46"
down_revision: str | None = "2114351c62ff"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_TRIGGERS = (
    "chat_search_chats_ai",
    "chat_search_chats_au",
    "chat_search_chats_ad",
    "chat_search_messages_ai",
    "chat_search_messages_au",
    "chat_search_messages_ad",
)

SCHEMA = (
    "CREATE TABLE chat_search_keys (id INTEGER PRIMARY KEY, chat_id CHAR(32) NOT NULL, message_id CHAR(32) UNIQUE)",
    "CREATE UNIQUE INDEX chat_search_keys_title ON chat_search_keys (chat_id) WHERE message_id IS NULL",
    "CREATE INDEX chat_search_keys_chat ON chat_search_keys (chat_id, message_id)",
    "CREATE VIRTUAL TABLE chat_search USING fts5(chat_id UNINDEXED, user_id UNINDEXED, content)",
)

REBUILD = (
    "INSERT INTO chat_search_keys (chat_id, message_id) SELECT id, NULL FROM chats ORDER BY created_at, id",
    "INSERT INTO chat_search_keys (chat_id, message_id) SELECT chat_id, id FROM messages ORDER BY created_at, id",
    "INSERT INTO chat_search (rowid, chat_id, user_id, content) "
    "SELECT keys.id, chats.id, chats.user_id, coalesce(chats.title, '') "
    "FROM chat_search_keys AS keys JOIN chats ON chats.id = keys.chat_id WHERE keys.message_id IS NULL",
    "INSERT INTO chat_search (rowid, chat_id, user_id, content) "
    "SELECT keys.id, chats.id, chats.user_id, coalesce(messages.content, '') "
    "FROM chat_search_keys AS keys JOIN messages ON messages.id = keys.message_id "
    "JOIN chats ON chats.id = messages.chat_id",
)

TRIGGERS = (
    "CREATE TRIGGER chat_search_chats_ai AFTER INSERT ON chats BEGIN "
    "INSERT INTO chat_search_keys (chat_id, message_id) VALUES (new.id, NULL); "
    "INSERT INTO chat_search (rowid, chat_id, user_id, content) "
    "VALUES ((SELECT id FROM chat_search_keys WHERE chat_id = new.id AND message_id IS NULL), "
    "new.id, new.user_id, coalesce(new.title, '')); END",
    "CREATE TRIGGER chat_search_chats_au AFTER UPDATE OF title ON chats WHEN old.title IS NOT new.title BEGIN "
    "UPDATE chat_search SET content = coalesce(new.title, '') "
    "WHERE rowid = (SELECT id FROM chat_search_keys WHERE chat_id = new.id AND message_id IS NULL); END",
    "CREATE TRIGGER chat_search_chats_ad AFTER DELETE ON chats BEGIN "
    "DELETE FROM chat_search WHERE rowid IN (SELECT id FROM chat_search_keys WHERE chat_id = old.id); "
    "DELETE FROM chat_search_keys WHERE chat_id = old.id; END",
    "CREATE TRIGGER chat_search_messages_ai AFTER INSERT ON messages BEGIN "
    "INSERT INTO chat_search_keys (chat_id, message_id) VALUES (new.chat_id, new.id); "
    "INSERT INTO chat_search (rowid, chat_id, user_id, content) "
    "SELECT (SELECT id FROM chat_search_keys WHERE message_id = new.id), chats.id, chats.user_id, "
    "coalesce(new.content, '') FROM chats WHERE chats.id = new.chat_id; END",
    "CREATE TRIGGER chat_search_messages_au AFTER UPDATE OF content, chat_id ON messages "
    "WHEN old.content IS NOT new.content OR old.chat_id IS NOT new.chat_id BEGIN "
    "UPDATE chat_search_keys SET chat_id = new.chat_id WHERE message_id = new.id; "
    "UPDATE chat_search SET chat_id = new.chat_id, content = coalesce(new.content, ''), "
    "user_id = (SELECT user_id FROM chats WHERE id = new.chat_id) "
    "WHERE rowid = (SELECT id FROM chat_search_keys WHERE message_id = new.id); END",
    "CREATE TRIGGER chat_search_messages_ad AFTER DELETE ON messages BEGIN "
    "DELETE FROM chat_search WHERE rowid = (SELECT id FROM chat_search_keys WHERE message_id = old.id); "
    "DELETE FROM chat_search_keys WHERE message_id = old.id; END",
)


def upgrade() -> None:
    for name in OLD_TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {name}")
    op.execute("DROP TABLE IF EXISTS chat_search")
    for statement in (*SCHEMA, *REBUILD, *TRIGGERS):
        op.execute(statement)
