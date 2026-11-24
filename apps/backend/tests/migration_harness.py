"""Helpers for migration tests (ADR-0069): build a database at revision N-1, seed it, upgrade.

Typical data-migration test::

    async def test_widgets_backfill(migration_db):
        await upgrade_to(migration_db, PREVIOUS)      # the revision before yours
        with sqlite3.connect(migration_db) as db:     # seed rows in the old shape
            db.execute("INSERT INTO ...")
        await upgrade_to(migration_db, "head")
        with sqlite3.connect(migration_db) as db:     # assert the new shape
            ...

``migration_db`` (see ``tests/test_migrations.py``) points ``config`` at a
temporary SQLite file. Seed with plain SQL: models describe the head schema,
not revision N-1.
"""

import sqlite3
from pathlib import Path

from alembic import command
from asterism.db.migrate import alembic_config, upgrade_database
from sqlalchemy.ext.asyncio import create_async_engine


async def upgrade_to(database: Path, revision: str) -> None:
    """Upgrade ``database`` to ``revision``; ``"head"`` goes through the production path."""
    if revision == "head":
        await upgrade_database()
        return
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")

    def run(connection) -> None:
        alembic = alembic_config()
        alembic.attributes["connection"] = connection
        command.upgrade(alembic, revision)

    try:
        async with engine.begin() as connection:
            await connection.run_sync(run)
    finally:
        await engine.dispose()


def _table_items(body: str) -> tuple[str, ...]:
    """Split a CREATE TABLE body on top-level commas (ignoring quoted text and nested parentheses)."""
    items, depth, quote, start = [], 0, "", 0
    for index, char in enumerate(body):
        if quote:
            quote = "" if char == quote else quote
        elif char in "'\"":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "," and depth == 0:
            items.append(body[start:index])
            start = index + 1
    items.append(body[start:])
    return tuple(sorted(" ".join(item.split()) for item in items))


def _normalized(kind: str, sql: str) -> str | tuple[str, ...]:
    """Whitespace-normalized SQL; a plain table's columns and constraints compare in any order.

    Order differs between ``create_all`` and migrations (constraint rendering,
    and columns a later migration adds land at the end), and does not change
    behavior.
    """
    text = " ".join(sql.split())
    if kind == "table" and text.startswith("CREATE TABLE "):
        head, _, rest = text.partition("(")
        # A table rebuilt by a batch migration quotes its name; quoting is cosmetic.
        return (head.replace('"', "").strip(), *_table_items(rest.rsplit(")", 1)[0]))
    return text


def schema_objects(database: Path) -> set[tuple[str, str, str, str | tuple[str, ...]]]:
    """Every schema object (type, name, table, normalized SQL) except Alembic's version table."""
    with sqlite3.connect(database) as connection:
        rows = connection.execute(
            "SELECT type, name, tbl_name, coalesce(sql, '') FROM sqlite_master WHERE tbl_name != 'alembic_version'"
        ).fetchall()
    return {(kind, name, table, _normalized(kind, sql)) for kind, name, table, sql in rows}
