"""Versioned schema migrations for the backend database (ADR-0069).

The Alembic revision stored in ``alembic_version`` is the schema version.
``init_db`` and container startup call :func:`upgrade_database`; the API
process calls :func:`verify_database_revision` before serving and refuses a
database that is not at this code's head.

Migrations are forward-only. A database whose revision this code does not
know (it is newer, or from another branch) is refused with both revisions
named; the way back is restoring a backup. A non-empty database without an
``alembic_version`` table predates the baseline and is refused too: it must be
reset once (development data only).

Migrations run on their own short-lived engine, without the application's
PRAGMAs (so SQLite foreign keys are off during table rebuilds) and with an
explicit ``BEGIN`` so each upgrade is one SQLite transaction, DDL included.
"""

from pathlib import Path
from typing import Any

from alembic import command
from alembic.autogenerate.api import AutogenContext
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import event, inspect
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.sql import sqltypes
from sqlalchemy.types import TypeDecorator, TypeEngine

from asterism.core import config

MIGRATIONS_DIR = Path(__file__).with_name("migrations")
VERSION_TABLE = "alembic_version"


class SchemaRevisionError(RuntimeError):
    """The database's schema revision cannot be used by this code."""


def alembic_config() -> Config:
    """Alembic configuration pointing at the packaged migration scripts."""
    alembic = Config()
    alembic.set_main_option("script_location", str(MIGRATIONS_DIR))
    alembic.set_main_option("path_separator", "os")
    return alembic


def script_directory() -> ScriptDirectory:
    return ScriptDirectory.from_config(alembic_config())


def head_revision() -> str:
    """The single head revision of the migration history."""
    heads = script_directory().get_heads()
    if len(heads) != 1:
        raise SchemaRevisionError(f"Migration history must have exactly one head, found: {', '.join(heads)}")
    return heads[0]


def render_item(type_: str, obj: Any, autogen_context: AutogenContext) -> str | bool:
    """Render application column types as their plain SQL types in migration scripts.

    Migration scripts must not import application types, which may change or
    disappear later. ``jsonb_type()`` columns render as ``sa.JSON()`` (their
    variants only add Python-side processing), and other ``TypeDecorator``
    columns (e.g. encrypted text) render as their underlying ``impl``.
    """
    if type_ != "type" or not isinstance(obj, TypeEngine):
        return False
    base: TypeEngine = obj
    if getattr(base, "_variant_mapping", None):
        base = base.copy()
        base._variant_mapping = {}  # pyright: ignore[reportAttributeAccessIssue]
    if isinstance(base, TypeDecorator):
        base = base.impl_instance
    if base is obj:
        return False
    return f"sa.{base!r}"


# SQLite FTS5 indexes are created by migrations as raw SQL and are not models.
FTS_TABLES = ("chat_search", "project_search")


def include_object(obj: Any, name: str | None, type_: str, reflected: bool, compare_to: Any) -> bool:
    """Leave FTS5 virtual tables and their shadow tables out of autogenerate."""
    if type_ == "table" and reflected and compare_to is None and name:
        return not any(name == fts or name.startswith(f"{fts}_") for fts in FTS_TABLES)
    return True


def _literal_default(value: str) -> str:
    """Reduce a default to its bare literal: reflected ``('')``/``'1'`` and rendered ``''``/``1`` compare equal."""
    value = value.strip()
    while value.startswith("(") and value.endswith(")") and value[1:-1].strip().startswith("'"):
        value = value[1:-1].strip()
    if len(value) >= 2 and value.startswith("'") and value.endswith("'"):
        value = value[1:-1].replace("''", "'")
    return value


def compare_server_default(
    context: Any,
    inspected_column: Any,
    metadata_column: Any,
    inspected_default: str | None,
    metadata_default: Any,
    rendered_metadata_default: str | None,
) -> bool | None:
    """Compare SQLite defaults by literal value, ignoring reflection's quoting and parentheses."""
    if inspected_default is None or rendered_metadata_default is None:
        return None
    return _literal_default(inspected_default) != _literal_default(rendered_metadata_default)


def compare_type(
    context: Any,
    inspected_column: Any,
    metadata_column: Any,
    inspected_type: TypeEngine,
    metadata_type: TypeEngine,
) -> bool | None:
    """SQLite reflects a declared ``UUID`` column as NUMERIC; that is the same column. Defer otherwise."""
    if (
        context.dialect.name == "sqlite"
        and isinstance(metadata_type, sqltypes.UUID)
        and isinstance(inspected_type, sqltypes.NUMERIC)
    ):
        return False
    return None


# Shared by env.py (contributors' ``--autogenerate``) and the schema parity test.
AUTOGENERATE_OPTIONS: dict[str, Any] = {
    "compare_type": compare_type,
    "compare_server_default": compare_server_default,
    "render_item": render_item,
    "include_object": include_object,
}


def _migration_engine() -> AsyncEngine:
    if not config.db_url:
        raise RuntimeError("Database URL is not set in the configuration")
    engine = create_async_engine(config.db_url)
    if engine.dialect.name == "sqlite":
        # pysqlite otherwise commits implicitly around DDL; take control of
        # transactions so a failed migration rolls back completely.
        @event.listens_for(engine.sync_engine, "connect")
        def _connect(dbapi_connection, _record) -> None:
            dbapi_connection.isolation_level = None

        @event.listens_for(engine.sync_engine, "begin")
        def _begin(connection: Connection) -> None:
            connection.exec_driver_sql("BEGIN")

    return engine


def current_revision(connection: Connection) -> str | None:
    """The revision recorded in the database, or ``None`` when unversioned."""
    return MigrationContext.configure(connection).get_current_revision()


def _check_known(connection: Connection) -> str | None:
    """Return the database revision after refusing ones this code cannot upgrade."""
    revision = current_revision(connection)
    head = head_revision()
    if revision is None:
        tables = [name for name in inspect(connection).get_table_names() if name != VERSION_TABLE]
        if tables:
            raise SchemaRevisionError(
                "The backend database predates versioned migrations (no schema revision; "
                f"this code is at {head}). It comes from a development build before 0.2.0 and "
                "can't be upgraded, so start with empty storage, which deletes its data. "
                "In a checkout, run `pnpm reset:db`. With Docker, stop the app and remove the "
                "storage volume (`docker compose down`, then `docker volume rm <project>_storage`)."
            )
        return None
    known = {script.revision for script in script_directory().walk_revisions()}
    if revision not in known:
        raise SchemaRevisionError(
            f"The backend database is at schema revision {revision}, which this code does not know "
            f"(this code is at {head}). It may come from a newer version of Asterism. "
            "Run that version, or restore a backup taken for this version; migrations never go backwards."
        )
    return revision


def _upgrade(connection: Connection) -> None:
    _check_known(connection)
    alembic = alembic_config()
    alembic.attributes["connection"] = connection
    command.upgrade(alembic, "head")


def _verify(connection: Connection) -> None:
    revision = _check_known(connection)
    head = head_revision()
    if revision != head:
        raise SchemaRevisionError(
            f"The backend database is at schema revision {revision or 'none (empty)'}, but this code needs {head}. "
            "Apply pending migrations with `pnpm --filter @asterism/backend init:db` before starting."
        )


async def upgrade_database() -> None:
    """Apply pending migrations up to head in one transaction, refusing unknown revisions."""
    engine = _migration_engine()
    try:
        async with engine.begin() as connection:
            await connection.run_sync(_upgrade)
    finally:
        await engine.dispose()


async def verify_database_revision() -> None:
    """Refuse to serve unless the database is exactly at this code's head revision."""
    engine = _migration_engine()
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_verify)
    finally:
        await engine.dispose()
