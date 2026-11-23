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
        with pytest.raises(SchemaRevisionError, match="predates versioned migrations") as refused:
            await action()
        assert "pnpm reset:db" in str(refused.value)
        assert "docker volume rm" in str(refused.value)
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


@pytest.mark.asyncio
async def test_account_lifecycle_upgrade_keeps_users_active(migration_db):
    """e720dd8451d4: existing users get no suspension and no deletion request."""
    await upgrade_to(migration_db, BASELINE)
    with sqlite3.connect(migration_db) as connection:
        connection.execute("INSERT INTO users (id, name) VALUES ('user-1', 'Ada')")

    await upgrade_to(migration_db, "e720dd8451d4")

    with sqlite3.connect(migration_db) as connection:
        assert connection.execute("SELECT id, name, suspended_at FROM users").fetchall() == [("user-1", "Ada", None)]
        assert connection.execute("SELECT count(*) FROM account_deletion_requests").fetchone() == (0,)


@pytest.mark.asyncio
async def test_compaction_names_saved_as_an_id_get_the_model_name(migration_db):
    """c3a1f0d2b9e4 (US-90.3): an id stored as the name becomes the model's visible name."""
    await upgrade_to(migration_db, "2a4c7bb2e747")
    shown, plain, gone = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    rows = {
        "id-shown": (shown, str(shown)),  # display name wins
        "id-plain": (plain, str(plain)),  # no display name: the model's name
        "id-gone": (gone, str(gone)),  # the model was deleted: left as stored
        "named": (shown, "Already named"),  # a real name is never touched
    }
    with sqlite3.connect(migration_db) as connection:
        for model_id, name, display in ((shown, "gpt-x", "Tutor model"), (plain, "plain-model", None)):
            connection.execute(
                "INSERT INTO models (id, provider_id, name, display_name, is_active) VALUES (?, ?, ?, ?, 1)",
                (model_id.hex, uuid.uuid4().hex, name, display),
            )
        for anchor, (model_id, model_name) in rows.items():
            connection.execute(
                "INSERT INTO chat_compactions (id, user_id, chat_id, through_message_id, summary, "
                "replaced_messages, model_id, model_name, input_tokens, output_tokens, "
                "estimated_tokens_before, trigger, created_at) "
                "VALUES (?, 'user-1', ?, ?, 'Summary', 1, ?, ?, 0, 0, 0, 'manual', 0)",
                (
                    uuid.uuid4().hex,
                    uuid.uuid4().hex,
                    uuid.uuid5(uuid.NAMESPACE_URL, anchor).hex,
                    model_id.hex,
                    model_name,
                ),
            )

    await upgrade_to(migration_db, "head")

    with sqlite3.connect(migration_db) as connection:
        names = dict(connection.execute("SELECT through_message_id, model_name FROM chat_compactions").fetchall())
    assert {anchor: names[uuid.uuid5(uuid.NAMESPACE_URL, anchor).hex] for anchor in rows} == {
        "id-shown": "Tutor model",
        "id-plain": "plain-model",
        "id-gone": str(gone),
        "named": "Already named",
    }


@pytest.mark.asyncio
async def test_memories_upgrade_keeps_users_and_enforces_memory_rules(migration_db):
    """8cf8b3b71e49 (US-93.1): an existing database gains an empty memories table with its rules."""
    await upgrade_to(migration_db, "c3a1f0d2b9e4")
    with sqlite3.connect(migration_db) as connection:
        connection.execute("INSERT INTO users (id) VALUES ('user-1')")

    await upgrade_to(migration_db, "head")

    def insert(connection, **values):
        row = {
            "id": uuid.uuid4().hex,
            "user_id": "user-1",
            "kind": "user",
            "project_id": None,
            "text": "Learns best from worked examples",
            "category": "learning",
            "sensitive": 0,
            "created_at": 0,
            "updated_at": 0,
        } | values
        columns = ", ".join(row)
        connection.execute(
            f"INSERT INTO memories ({columns}) VALUES ({', '.join('?' * len(row))})", tuple(row.values())
        )

    with sqlite3.connect(migration_db) as connection:
        assert connection.execute("SELECT id FROM users").fetchall() == [("user-1",)]
        assert connection.execute("SELECT count(*) FROM memories").fetchone() == (0,)
        connection.execute("PRAGMA foreign_keys = ON")
        insert(connection)
        saved = connection.execute("SELECT revision, saved_by FROM memories").fetchone()
        assert saved == (1, "person")
        for broken in (
            {"kind": "project"},  # project memory needs a project and no category
            {"category": None},  # user memory needs a category
            {"category": "accessibility"},  # accessibility memories are sensitive
            {"text": "   "},
            {"text": "x" * 2001},
            {"text": "a\x00b"},
            {"user_id": "nobody"},
        ):
            with pytest.raises(sqlite3.IntegrityError):
                insert(connection, **broken)
        insert(connection, category="accessibility", sensitive=1)


@pytest.mark.asyncio
async def test_class_memory_switch_upgrade_keeps_classes_with_memory_on(migration_db):
    """04f31c3d0a0e (US-93.2): existing classes keep their policy and get memory on."""
    await upgrade_to(migration_db, "8cf8b3b71e49")
    class_id = uuid.uuid4().hex
    with sqlite3.connect(migration_db) as connection:
        connection.execute("INSERT INTO users (id) VALUES ('teach')")
        connection.execute(
            "INSERT INTO classes (id, educator_id, name, join_code, allowed_modes, answer_reveal, created_at, "
            "updated_at) VALUES (?, 'teach', 'Biology', 'JOIN1234', '[\"socratic\"]', 0, 0, 0)",
            (class_id,),
        )

    await upgrade_to(migration_db, "head")

    with sqlite3.connect(migration_db) as connection:
        row = connection.execute(
            "SELECT name, allowed_modes, answer_reveal, memory_enabled FROM classes WHERE id = ?", (class_id,)
        ).fetchone()
    assert row == ("Biology", '["socratic"]', 0, 1)


@pytest.mark.asyncio
async def test_message_memories_upgrade_adds_an_empty_table_that_follows_its_memory(migration_db):
    """49c16efb8995 (US-93.5): pinned copies are deleted with their memory."""
    await upgrade_to(migration_db, "04f31c3d0a0e")
    memory_id, message_id = (uuid.uuid4().hex for _ in range(2))
    with sqlite3.connect(migration_db) as connection:
        connection.execute("INSERT INTO users (id) VALUES ('user-1')")
        connection.execute(
            "INSERT INTO memories (id, user_id, kind, text, category, sensitive, created_at, updated_at) "
            "VALUES (?, 'user-1', 'user', 'Learns from examples', 'learning', 0, 0, 0)",
            (memory_id,),
        )

    await upgrade_to(migration_db, "head")

    with sqlite3.connect(migration_db) as connection:
        assert connection.execute("SELECT count(*) FROM message_memories").fetchone() == (0,)
        # The pin's message isn't seeded: foreign keys are off for this insert only.
        connection.execute(
            "INSERT INTO message_memories (id, user_id, message_id, memory_id, revision, text, position) "
            "VALUES (?, 'user-1', ?, ?, 1, 'Learns from examples', 0)",
            (uuid.uuid4().hex, message_id, memory_id),
        )
    connection = sqlite3.connect(migration_db)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        assert connection.execute("SELECT count(*) FROM message_memories").fetchone() == (0,)
    finally:
        connection.close()


@pytest.mark.asyncio
async def test_memory_proposals_upgrade_adds_empty_tables_with_their_rules(migration_db):
    """5d2e7a9c4b1f (US-93.4): proposals start empty, keep their rules and outlive a deleted memory."""
    await upgrade_to(migration_db, "49c16efb8995")
    memory_id = uuid.uuid4().hex
    with sqlite3.connect(migration_db) as connection:
        connection.execute("INSERT INTO users (id) VALUES ('user-1')")
        connection.execute(
            "INSERT INTO memories (id, user_id, kind, text, category, sensitive, created_at, updated_at) "
            "VALUES (?, 'user-1', 'user', 'Learns from examples', 'learning', 0, 0, 0)",
            (memory_id,),
        )

    await upgrade_to(migration_db, "head")

    def insert(connection, **values):
        row = {
            "id": uuid.uuid4().hex,
            "user_id": "user-1",
            "chat_id": uuid.uuid4().hex,
            "message_id": uuid.uuid4().hex,
            "execution_id": uuid.uuid4().hex,
            "kind": "user",
            "text": "Learns from examples",
            "category": "learning",
            "sensitive": 0,
            "status": "saved",
            "memory_id": memory_id,
            "created_at": 0,
            "decided_at": 1,
        } | values
        connection.execute(
            f"INSERT INTO memory_proposals ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
            tuple(row.values()),
        )

    with sqlite3.connect(migration_db) as connection:
        assert connection.execute("SELECT count(*) FROM memory_proposals").fetchone() == (0,)
        assert connection.execute("SELECT count(*) FROM memory_proposal_events").fetchone() == (0,)
        # The proposal's chat isn't seeded: foreign keys are off for these inserts.
        insert(connection)
        for broken in (
            {"status": "pending"},  # a pending proposal has no decision time
            {"status": "dismissed", "decided_at": None},
            {"category": "accessibility"},  # accessibility is sensitive
            {"kind": "project"},  # project proposals need a project and no category
        ):
            with pytest.raises(sqlite3.IntegrityError):
                insert(connection, **broken)
    connection = sqlite3.connect(migration_db)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        assert connection.execute("SELECT status, memory_id FROM memory_proposals").fetchall() == [("saved", None)]
    finally:
        connection.close()
