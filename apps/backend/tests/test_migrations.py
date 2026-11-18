"""Versioned schema migrations (ADR-0069): parity with the models, revision guards, upgrade harness."""

import shutil
import sqlite3
import uuid

import pytest
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from asterism.core import config
from asterism.db.init_db import initialize_database
from asterism.db.migrate import (
    AUTOGENERATE_OPTIONS,
    MIGRATIONS_DIR,
    SchemaRevisionError,
    head_revision,
    script_directory,
    upgrade_database,
    verify_database_revision,
)
from asterism.db.model_registry import Base
from asterism.domains.chat.search_index import initialize_search_index
from migration_harness import schema_objects, upgrade_to
from sqlalchemy.ext.asyncio import create_async_engine

BASELINE = "7526419cbbde"


@pytest.fixture
def migration_db(tmp_path, monkeypatch):
    database = tmp_path / "database.db"
    monkeypatch.setattr(config, "storage_root", tmp_path)
    monkeypatch.setattr(config, "db_url", f"sqlite+aiosqlite:///{database}")
    return database


async def _create_from_models(database) -> None:
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await initialize_search_index(connection)
    await engine.dispose()


def _set_revision(database, revision: str) -> None:
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE alembic_version SET version_num = ?", (revision,))


def test_history_is_linear_from_the_baseline():
    scripts = list(script_directory().walk_revisions())
    assert scripts[-1].revision == BASELINE
    assert scripts[-1].down_revision is None
    assert head_revision() == scripts[0].revision


@pytest.mark.asyncio
async def test_migration_head_matches_models_including_triggers_and_fts(migration_db, tmp_path):
    """CI check: changing a model, trigger or FTS definition without a migration fails here."""
    await upgrade_database()
    reference = tmp_path / "models.db"
    await _create_from_models(reference)

    assert schema_objects(migration_db) == schema_objects(reference)

    engine = create_async_engine(f"sqlite+aiosqlite:///{migration_db}")

    def diff(connection):
        context = MigrationContext.configure(
            connection,
            opts=AUTOGENERATE_OPTIONS,
        )
        return compare_metadata(context, Base.metadata)

    async with engine.connect() as connection:
        differences = await connection.run_sync(diff)
    await engine.dispose()
    assert differences == [], f"Models differ from the migration head; add a migration: {differences}"

    with sqlite3.connect(migration_db) as migrated, sqlite3.connect(reference) as modeled:
        query = "SELECT id, name, built_in FROM groups ORDER BY id"
        assert migrated.execute(query).fetchall() == modeled.execute(query).fetchall()


@pytest.mark.asyncio
async def test_initialization_upgrades_to_head_and_is_repeatable(migration_db):
    await initialize_database()
    await initialize_database()
    await verify_database_revision()
    with sqlite3.connect(migration_db) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchall() == [(head_revision(),)]


@pytest.mark.asyncio
async def test_unknown_or_newer_revision_is_refused_naming_both(migration_db):
    await upgrade_database()
    _set_revision(migration_db, "f00dfeed0000")
    before = schema_objects(migration_db)

    for action in (upgrade_database, initialize_database, verify_database_revision):
        with pytest.raises(SchemaRevisionError) as refused:
            await action()
        assert "f00dfeed0000" in str(refused.value)
        assert head_revision() in str(refused.value)
    assert schema_objects(migration_db) == before


@pytest.mark.asyncio
async def test_pre_baseline_database_is_refused_without_changes(migration_db):
    await _create_from_models(migration_db)
    before = schema_objects(migration_db)

    for action in (upgrade_database, verify_database_revision):
        with pytest.raises(SchemaRevisionError, match="predates versioned migrations"):
            await action()
    assert schema_objects(migration_db) == before


@pytest.mark.asyncio
async def test_startup_refuses_a_database_behind_head(migration_db, monkeypatch):
    with pytest.raises(SchemaRevisionError, match="init:db"):
        await verify_database_revision()

    await upgrade_database()
    monkeypatch.setattr("asterism.db.migrate.head_revision", lambda: "aaaaaaaaaaaa")
    monkeypatch.setattr(
        "asterism.db.migrate._check_known", lambda connection: BASELINE
    )  # simulate code one revision ahead
    with pytest.raises(SchemaRevisionError, match=f"{BASELINE}.*aaaaaaaaaaaa"):
        await verify_database_revision()


BROKEN_REVISION = """
import sqlalchemy as sa
from alembic import op

revision = "b0b0b0b0b0b0"
down_revision = {head!r}


def upgrade():
    op.create_table("half_done", sa.Column("id", sa.Integer, primary_key=True))
    op.execute("INSERT INTO groups (id, name, built_in, created_at, updated_at) VALUES ('x', 'X', 0, 0, 0)")
    raise RuntimeError("migration failed midway")
"""


@pytest.mark.asyncio
async def test_failed_migration_rolls_back_completely(migration_db, tmp_path, monkeypatch):
    scripts = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS_DIR, scripts, ignore=shutil.ignore_patterns("__pycache__"))
    (scripts / "versions" / "broken.py").write_text(BROKEN_REVISION.format(head=head_revision()))
    monkeypatch.setattr("asterism.db.migrate.MIGRATIONS_DIR", scripts)

    with pytest.raises(RuntimeError, match="midway"):
        await upgrade_database()
    assert schema_objects(migration_db) == set()


@pytest.mark.asyncio
async def test_data_seeded_at_previous_revision_survives_upgrade(migration_db):
    """Harness example: seed at N-1 with plain SQL, upgrade to head, assert the data."""
    previous = script_directory().get_revision(head_revision()).down_revision or BASELINE
    await upgrade_to(migration_db, previous)

    user_id, chat_id = "user-1", uuid.uuid4().hex
    with sqlite3.connect(migration_db) as connection:
        connection.execute("INSERT INTO users (id, name) VALUES (?, 'Ada')", (user_id,))
        connection.execute(
            "INSERT INTO chats (id, user_id, title, learning_mode, model_revision, allowed_tools, "
            "created_at, updated_at) VALUES (?, ?, 'Orbital notes', 'standard', 1, '[]', 0, 0)",
            (chat_id, user_id),
        )

    await upgrade_to(migration_db, "head")

    with sqlite3.connect(migration_db) as connection:
        assert connection.execute("SELECT name, group_id FROM users").fetchall() == [("Ada", "student")]
        assert connection.execute("SELECT chat_id FROM chat_search WHERE chat_search MATCH 'orbital'").fetchall() == [
            (chat_id,)
        ]
