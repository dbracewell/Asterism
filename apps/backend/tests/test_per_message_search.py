"""US-122.1 (ADR-0085): one chat search row per message and per title."""

import sqlite3
import uuid

import pytest
from asterism.db.migrate import script_directory
from asterism.domains.chat.models import ChatModel, MessageModel
from asterism.domains.chat.schemas import MessageStatus, SearchResultKind
from asterism.domains.chat.service import search
from migration_harness import upgrade_to
from sqlalchemy import text
from test_chat_search import search_session as _search_session
from test_migrations import migration_db as _migration_db

search_session, migration_db = _search_session, _migration_db
REVISION = "5c38bc190c46"


async def _rows(session, chat_id) -> dict[int, str]:
    """The chat's index rows: rowid to indexed text."""
    result = await session.execute(
        text("SELECT rowid, content FROM chat_search WHERE chat_id = :chat_id"), {"chat_id": chat_id.hex}
    )
    return dict(result.tuples().all())


async def _hits(session, query, user="user-a"):
    result = await search(user, query, session=session)
    return {item.id for item in result.results if item.kind is SearchResultKind.CHAT}


def _message(chat, content, role="user"):
    return MessageModel(
        user_id=chat.user_id, chat_id=chat.id, role=role, content=content, status=MessageStatus.COMPLETED
    )


@pytest.mark.asyncio
async def test_each_write_touches_only_its_own_row(search_session):
    chat = ChatModel(user_id="user-a", title="Field notes")
    search_session.add(chat)
    await search_session.flush()
    messages = [_message(chat, f"entry {n} " + "x " * 200) for n in range(40)]
    search_session.add_all(messages)
    await search_session.commit()
    before = await _rows(search_session, chat.id)
    assert len(before) == 41, "one row per message plus the title"

    new = _message(chat, "fresh moraine")
    search_session.add(new)
    await search_session.commit()
    after = await _rows(search_session, chat.id)
    assert {rowid: after[rowid] for rowid in before} == before, "earlier rows are untouched"
    assert [after[rowid] for rowid in set(after) - set(before)] == ["fresh moraine"]

    messages[3].content = "edited esker"
    await search_session.commit()
    edited = await _rows(search_session, chat.id)
    changed = {rowid for rowid in after if edited.get(rowid) != after[rowid]}
    assert len(changed) == 1 and edited[changed.pop()] == "edited esker"

    chat.title = "Glacier notes"
    await search_session.commit()
    renamed = await _rows(search_session, chat.id)
    assert {rowid for rowid in edited if renamed[rowid] != edited[rowid]} == {
        rowid for rowid, content in edited.items() if content == "Field notes"
    }

    await search_session.delete(messages[0])
    await search_session.commit()
    deleted = await _rows(search_session, chat.id)
    assert (
        set(renamed) - set(deleted) == {rowid for rowid, content in renamed.items() if content.startswith("entry 0 ")}
        and len(deleted) == 41
    )


@pytest.mark.asyncio
async def test_one_hit_per_chat_with_terms_across_messages_and_owners_kept_apart(search_session):
    spread = ChatModel(user_id="user-a", title="Trip")
    single = ChatModel(user_id="user-a", title="Other")
    theirs = ChatModel(user_id="user-b", title="Trip")
    search_session.add_all([spread, single, theirs])
    await search_session.flush()
    search_session.add_all(
        [
            _message(spread, "the glacier"),
            _message(spread, "a volcano", role="assistant"),
            _message(spread, "glacier again"),
            _message(single, "glacier only"),
            _message(theirs, "glacier volcano"),
        ]
    )
    await search_session.commit()

    result = await search("user-a", "glacier", session=search_session)
    assert sorted(str(item.id) for item in result.results) == sorted([str(spread.id), str(single.id)])
    assert result.total == 2, "a chat with several matching messages is one hit"
    # Terms may sit in different messages, or in the title and a message.
    assert await _hits(search_session, "glacier volcano") == {spread.id}
    assert await _hits(search_session, "trip volcano") == {spread.id}
    assert await _hits(search_session, "glacier volcano", user="user-b") == {theirs.id}
    assert await _hits(search_session, "glacier tundra") == set()


def _insert(connection, table: str, values: dict) -> None:
    """Insert a row, filling any other required column with a neutral value."""
    for _, name, kind, notnull, default, _pk in connection.execute(f"PRAGMA table_info({table})"):
        if notnull and default is None and name not in values:
            kind = kind.upper()
            values[name] = 0 if "INT" in kind or "BOOL" in kind else "[]" if "JSON" in kind else ""
    columns = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    connection.execute(f"INSERT INTO {table} ({columns}) VALUES ({marks})", tuple(values.values()))


@pytest.mark.asyncio
async def test_upgrade_rebuilds_the_index_per_message(migration_db):
    previous = script_directory().get_revision(REVISION).down_revision
    await upgrade_to(migration_db, previous)
    chat, other = uuid.uuid4().hex, uuid.uuid4().hex
    with sqlite3.connect(migration_db) as connection:
        connection.execute("INSERT INTO users (id, name) VALUES ('user-1', 'Ada'), ('user-2', 'Bo')")
        for chat_id, user, title in ((chat, "user-1", "Orbital notes"), (other, "user-2", None)):
            _insert(
                connection,
                "chats",
                {"id": chat_id, "user_id": user, "title": title, "learning_mode": "standard", "model_revision": 1},
            )
        for n, (chat_id, user, content) in enumerate(
            [(chat, "user-1", "perigee burn"), (chat, "user-1", "apogee"), (other, "user-2", "perigee")]
        ):
            _insert(
                connection,
                "messages",
                {
                    "id": uuid.UUID(int=n + 1).hex,
                    "user_id": user,
                    "chat_id": chat_id,
                    "role": "user",
                    "content": content,
                    "status": "completed",
                    "created_at": n,
                },
            )
        assert connection.execute("SELECT count(*) FROM chat_search").fetchone() == (2,), "old: one row per chat"

    await upgrade_to(migration_db, REVISION)

    with sqlite3.connect(migration_db) as connection:
        rows = connection.execute(
            "SELECT chat_search.chat_id, user_id, content, chat_search_keys.message_id FROM chat_search "
            "JOIN chat_search_keys ON chat_search_keys.id = chat_search.rowid ORDER BY chat_search.rowid"
        ).fetchall()
        assert sorted(rows) == sorted(
            [
                (chat, "user-1", "Orbital notes", None),
                (other, "user-2", "", None),
                (chat, "user-1", "perigee burn", uuid.UUID(int=1).hex),
                (chat, "user-1", "apogee", uuid.UUID(int=2).hex),
                (other, "user-2", "perigee", uuid.UUID(int=3).hex),
            ]
        )

        def matching(user: str, *terms: str) -> set[str]:
            query = " INTERSECT ".join(
                "SELECT chat_id FROM chat_search WHERE user_id = ? AND chat_search MATCH ?" for _ in terms
            )
            arguments = [value for term in terms for value in (user, f'"{term}"')]
            return {row[0] for row in connection.execute(query, arguments)}

        assert matching("user-1", "orbital", "apogee") == {chat}
        assert matching("user-1", "perigee") == {chat}
        # The new triggers keep working on upgraded data.
        connection.execute("UPDATE messages SET content = 'transfer' WHERE id = ?", (uuid.UUID(int=2).hex,))
        connection.execute("DELETE FROM messages WHERE id = ?", (uuid.UUID(int=1).hex,))
        assert matching("user-1", "apogee") == set() and matching("user-1", "transfer") == {chat}
        assert matching("user-1", "perigee") == set()
        # Without the message cascade (foreign keys off here), a chat delete still clears its rows.
        connection.execute("DELETE FROM chats WHERE id = ?", (other,))
        assert connection.execute("SELECT count(*) FROM chat_search WHERE chat_id = ?", (other,)).fetchone() == (0,)
        assert connection.execute("SELECT count(*) FROM chat_search_keys WHERE chat_id = ?", (other,)).fetchone() == (
            0,
        )
