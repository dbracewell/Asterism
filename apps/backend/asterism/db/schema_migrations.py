import time
from collections.abc import Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from asterism.domains.settings.provider_types import OPENAI_BASE_URL

Migration = Callable[[AsyncConnection], Awaitable[None]]

_MIGRATION_TABLE = "asterism_schema_migrations"
_PROVIDER_CAPABILITIES_MIGRATION = "20250919_01_provider_types_capabilities"
_USER_FILES_MIGRATION = "20260401_01_user_files"
_MESSAGE_FILES_MIGRATION = "20260401_02_message_files"
_CHAT_AGENT_MIGRATION = "20260402_01_chat_agent"
_CHAT_SEARCH_MIGRATION = "20260403_01_chat_search_fts"
_MESSAGE_USAGE_MIGRATION = "20260404_01_message_usage"
_KNOWLEDGE_FOUNDATIONS_MIGRATION = "20260922_01_knowledge_foundations"
_KNOWLEDGE_BASE_CRUD_MIGRATION = "20260923_01_knowledge_base_crud"
_KNOWLEDGE_DOCUMENT_METADATA_MIGRATION = "20260923_02_knowledge_document_metadata"
_KNOWLEDGE_DOCUMENT_REVISIONS_MIGRATION = "20260923_03_knowledge_document_revisions"
_KNOWLEDGE_DOCUMENT_ORDER_MIGRATION = "20260923_04_knowledge_document_order"
_KNOWLEDGE_AUDIT_MIGRATION = "20260923_05_knowledge_audit"


async def _sqlite_columns(connection: AsyncConnection, table: str) -> set[str]:
    result = await connection.execute(text(f'PRAGMA table_info("{table}")'))
    return {str(row[1]) for row in result.fetchall()}


async def _add_column_if_missing(
    connection: AsyncConnection,
    table: str,
    column: str,
    definition: str,
) -> None:
    if column in await _sqlite_columns(connection, table):
        return
    await connection.execute(
        text(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {definition}')
    )


async def _migrate_message_files(connection: AsyncConnection) -> None:
    await _add_column_if_missing(
        connection,
        "messages",
        "files",
        "JSON NOT NULL DEFAULT '[]'",
    )


async def _migrate_user_files(connection: AsyncConnection) -> None:
    await connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS user_files ("
            "user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
            "filename VARCHAR(255) NOT NULL, "
            "original_name VARCHAR(255) NOT NULL, "
            "size INTEGER NOT NULL, "
            "mime_type VARCHAR(255) NOT NULL, "
            "kind VARCHAR(16) NOT NULL CHECK (kind IN ('image', 'text', 'document', 'other')), "
            "sha256 VARCHAR(64) NOT NULL, "
            "content_status VARCHAR(16) NOT NULL DEFAULT 'pending' "
            "CHECK (content_status IN ('pending', 'ready', 'unsupported', 'failed')), "
            "content_error VARCHAR(512), content_cache TEXT, "
            "id CHAR(32) NOT NULL PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, "
            "CONSTRAINT uq_user_files_user_filename UNIQUE (user_id, filename)"
            ")"
        )
    )
    await connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_user_files_user_filename "
            "ON user_files (user_id, filename)"
        )
    )


async def _migrate_chat_agent(connection: AsyncConnection) -> None:
    await _add_column_if_missing(
        connection,
        "chats",
        "agent_id",
        "CHAR(32)",
    )
    await connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_chats_agent_id ON chats (agent_id)"
        )
    )
    # SQLAlchemy stores SQLite UUIDs as 32 hexadecimal characters, while the
    # JSON setting stores their canonical dashed representation.
    await connection.execute(
        text(
            "UPDATE chats SET agent_id = ("
            "SELECT agent_profiles.id FROM user_settings "
            "JOIN agent_profiles ON agent_profiles.user_id = chats.user_id "
            "AND replace(json_extract(user_settings.value, '$'), '-', '') "
            "= agent_profiles.id "
            "WHERE user_settings.user_id = chats.user_id "
            "AND user_settings.key = 'default_agent_id' "
            "AND agent_profiles.sub_agent = 0"
            ") WHERE agent_id IS NULL"
        )
    )


async def _migrate_chat_search_fts(connection: AsyncConnection) -> None:
    """Maintain user-scoped SQLite FTS indexes without indexing file metadata."""
    await connection.execute(
        text(
            "CREATE VIRTUAL TABLE IF NOT EXISTS chat_search USING fts5("
            "chat_id UNINDEXED, user_id UNINDEXED, title, content)"
        )
    )
    await connection.execute(
        text(
            "CREATE VIRTUAL TABLE IF NOT EXISTS folder_search USING fts5("
            "folder_id UNINDEXED, user_id UNINDEXED, title)"
        )
    )
    await connection.execute(text("DELETE FROM chat_search"))
    await connection.execute(
        text(
            "INSERT INTO chat_search(chat_id, user_id, title, content) "
            "SELECT chats.id, chats.user_id, coalesce(chats.title, ''), "
            "coalesce(group_concat(messages.content, ' '), '') "
            "FROM chats LEFT JOIN messages ON messages.chat_id = chats.id "
            "GROUP BY chats.id"
        )
    )
    await connection.execute(text("DELETE FROM folder_search"))
    await connection.execute(
        text(
            "INSERT INTO folder_search(folder_id, user_id, title) "
            "SELECT id, user_id, title FROM folders"
        )
    )
    for statement in (
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


async def _migrate_provider_types_and_capabilities(
    connection: AsyncConnection,
) -> None:
    await _add_column_if_missing(
        connection,
        "providers",
        "provider_type",
        "VARCHAR(32) NOT NULL DEFAULT 'generic_openai' "
        "CHECK (provider_type IN ('openai', 'generic_openai'))",
    )
    await connection.execute(
        text(
            "UPDATE providers SET provider_type = 'openai', base_url = :canonical "
            "WHERE lower(rtrim(base_url, '/')) = :canonical"
        ),
        {"canonical": OPENAI_BASE_URL},
    )

    await _add_column_if_missing(
        connection,
        "models",
        "context_window",
        "INTEGER NULL CHECK (context_window IS NULL OR context_window > 0)",
    )
    await _add_column_if_missing(
        connection,
        "models",
        "supports_vision",
        "BOOLEAN NULL CHECK (supports_vision IS NULL OR supports_vision IN (0, 1))",
    )
    source_definition = (
        "VARCHAR(16) NOT NULL DEFAULT 'unknown' "
        "CHECK ({column} IN ('catalog', 'provider', 'manual', 'unknown'))"
    )
    await _add_column_if_missing(
        connection,
        "models",
        "context_window_source",
        source_definition.format(column="context_window_source"),
    )
    await _add_column_if_missing(
        connection,
        "models",
        "vision_source",
        source_definition.format(column="vision_source"),
    )


async def _migrate_knowledge_foundations(connection: AsyncConnection) -> None:
    """Create relational metadata without coupling it to vector implementation."""
    await connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS knowledge_bases ("
            "id CHAR(32) NOT NULL PRIMARY KEY, "
            "user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
            "name VARCHAR(255) NOT NULL, description TEXT, "
            "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL"
            ")"
        )
    )
    await connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_knowledge_bases_user_updated "
            "ON knowledge_bases (user_id, updated_at DESC)"
        )
    )
    await connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS knowledge_documents ("
            "id CHAR(32) NOT NULL PRIMARY KEY, "
            "knowledge_base_id CHAR(32) NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE, "
            "user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
            "file_id CHAR(32) REFERENCES user_files(id) ON DELETE SET NULL, "
            "original_name VARCHAR(255) NOT NULL, mime_type VARCHAR(255) NOT NULL, "
            "content_sha256 VARCHAR(64) NOT NULL, revision INTEGER NOT NULL DEFAULT 1, "
            "status VARCHAR(16) NOT NULL DEFAULT 'pending' "
            "CHECK (status IN ('pending', 'indexing', 'ready', 'failed')), "
            "error VARCHAR(512), indexed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL"
            ")"
        )
    )
    await connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_knowledge_documents_base_status "
            "ON knowledge_documents (knowledge_base_id, status, updated_at DESC)"
        )
    )


async def _migrate_knowledge_base_crud(connection: AsyncConnection) -> None:
    """Add the owner-scoped name invariant after the foundations migration."""
    await connection.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_bases_user_name "
            "ON knowledge_bases (user_id, name)"
        )
    )


async def _migrate_knowledge_document_metadata(connection: AsyncConnection) -> None:
    """Persist non-content document metadata and prevent duplicate attachments."""
    await _add_column_if_missing(
        connection,
        "knowledge_documents",
        "metadata",
        "JSON NOT NULL DEFAULT '{}'",
    )
    await connection.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_documents_base_file "
            "ON knowledge_documents (knowledge_base_id, file_id)"
        )
    )


async def _migrate_knowledge_document_revisions(connection: AsyncConnection) -> None:
    await _add_column_if_missing(
        connection,
        "knowledge_documents",
        "replaces_document_id",
        "CHAR(32) REFERENCES knowledge_documents(id) ON DELETE SET NULL",
    )


async def _migrate_knowledge_document_order(connection: AsyncConnection) -> None:
    await _add_column_if_missing(
        connection,
        "knowledge_documents",
        "position",
        "INTEGER NOT NULL DEFAULT 0",
    )


async def _migrate_knowledge_audit(connection: AsyncConnection) -> None:
    await connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS knowledge_audit_events ("
            "id CHAR(32) NOT NULL PRIMARY KEY, "
            "user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
            "knowledge_base_id CHAR(32) REFERENCES knowledge_bases(id) ON DELETE SET NULL, "
            "document_id CHAR(32) REFERENCES knowledge_documents(id) ON DELETE SET NULL, "
            "action VARCHAR(64) NOT NULL, details JSON NOT NULL DEFAULT '{}', "
            "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL"
            ")"
        )
    )
    await connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_knowledge_audit_events_user_created "
            "ON knowledge_audit_events (user_id, created_at)"
        )
    )


async def _migrate_message_usage(connection: AsyncConnection) -> None:
    for column in (
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "generation_duration_ms",
    ):
        await _add_column_if_missing(
            connection,
            "messages",
            column,
            "INTEGER NOT NULL DEFAULT 0",
        )


_MIGRATIONS: tuple[tuple[str, Migration], ...] = (
    (_KNOWLEDGE_FOUNDATIONS_MIGRATION, _migrate_knowledge_foundations),
    (_KNOWLEDGE_BASE_CRUD_MIGRATION, _migrate_knowledge_base_crud),
    (_KNOWLEDGE_DOCUMENT_METADATA_MIGRATION, _migrate_knowledge_document_metadata),
    (_KNOWLEDGE_DOCUMENT_REVISIONS_MIGRATION, _migrate_knowledge_document_revisions),
    (_KNOWLEDGE_DOCUMENT_ORDER_MIGRATION, _migrate_knowledge_document_order),
    (_KNOWLEDGE_AUDIT_MIGRATION, _migrate_knowledge_audit),
    (_MESSAGE_USAGE_MIGRATION, _migrate_message_usage),
    (_PROVIDER_CAPABILITIES_MIGRATION, _migrate_provider_types_and_capabilities),
    (_USER_FILES_MIGRATION, _migrate_user_files),
    (_MESSAGE_FILES_MIGRATION, _migrate_message_files),
    (_CHAT_AGENT_MIGRATION, _migrate_chat_agent),
    (_CHAT_SEARCH_MIGRATION, _migrate_chat_search_fts),
)


async def run_schema_migrations(connection: AsyncConnection) -> None:
    """Apply Asterism-owned relational schema migrations exactly once."""
    if connection.dialect.name != "sqlite":
        raise RuntimeError(
            f"Unsupported database dialect for schema migrations: "
            f"{connection.dialect.name}"
        )

    await connection.execute(
        text(
            f"CREATE TABLE IF NOT EXISTS {_MIGRATION_TABLE} ("
            "migration_id VARCHAR(128) PRIMARY KEY, "
            "applied_at INTEGER NOT NULL)"
        )
    )
    result = await connection.execute(
        text(f"SELECT migration_id FROM {_MIGRATION_TABLE}")
    )
    applied = {str(row[0]) for row in result.fetchall()}

    for migration_id, migration in _MIGRATIONS:
        if migration_id in applied:
            continue
        await migration(connection)
        await connection.execute(
            text(
                f"INSERT INTO {_MIGRATION_TABLE} (migration_id, applied_at) "
                "VALUES (:migration_id, :applied_at)"
            ),
            {"migration_id": migration_id, "applied_at": int(time.time())},
        )
