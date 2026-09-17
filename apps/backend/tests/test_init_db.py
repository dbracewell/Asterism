import sqlite3
from pathlib import Path

import pytest
from asterism.core import config
from asterism.db.init_db import (
    confirmed_reset,
    delete_database_files,
    initialize_database,
    sqlite_database_path,
)


def test_noninteractive_reset_is_not_confirmed(tmp_path, monkeypatch):
    database = tmp_path / "database.db"
    database.write_text("keep")
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    assert confirmed_reset(database, assume_yes=False) is False
    assert database.read_text() == "keep"


def test_delete_database_files_removes_only_selected_sqlite_files(tmp_path):
    database = tmp_path / "database.db"
    unrelated = tmp_path / "unrelated.db"
    for path in (database, Path(f"{database}-wal"), unrelated):
        path.write_text("data")
    delete_database_files(database)
    assert not database.exists()
    assert not Path(f"{database}-wal").exists()
    assert unrelated.exists()


@pytest.mark.asyncio
async def test_initialization_preserves_existing_database(tmp_path, monkeypatch):
    database = tmp_path / "database.db"
    monkeypatch.setattr(config, "storage_root", tmp_path)
    monkeypatch.setattr(config, "db_url", f"sqlite+aiosqlite:///{database}")
    await initialize_database()
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE preservation_canary (value TEXT)")
        connection.execute("INSERT INTO preservation_canary VALUES ('kept')")
        connection.commit()
    await initialize_database()
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT value FROM preservation_canary"
        ).fetchone() == ("kept",)


def test_sqlite_reset_rejects_remote_database(monkeypatch):
    monkeypatch.setattr(config, "db_url", "postgresql://user:secret@example.test/db")
    with pytest.raises(RuntimeError, match="only a local SQLite"):
        sqlite_database_path()
