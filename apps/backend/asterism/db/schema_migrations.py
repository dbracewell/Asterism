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


_MIGRATIONS: tuple[tuple[str, Migration], ...] = (
    (_PROVIDER_CAPABILITIES_MIGRATION, _migrate_provider_types_and_capabilities),
    (_USER_FILES_MIGRATION, _migrate_user_files),
    (_MESSAGE_FILES_MIGRATION, _migrate_message_files),
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
