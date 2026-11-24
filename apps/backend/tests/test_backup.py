"""Backup and restore (US-86.4): consistency under writes, refusals, and the CLI."""

import asyncio
import contextlib
import hashlib
import io
import json
import sqlite3
import stat
import tarfile
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
import pytest_asyncio
from asterism.backup.__main__ import main
from asterism.backup.archive import AUTH_DB, MANIFEST, BackupError, StorageLayout
from asterism.backup.create import create_backup, prune
from asterism.backup.restore import restore_backup
from asterism.core import config
from asterism.core.build_info import app_version
from asterism.db.database import db_session_manager, get_async_db_session
from asterism.db.init_db import initialize_database
from asterism.db.migrate import head_revision, script_directory, verify_database_revision
from asterism.domains.chat.models import ChatModel, MessageModel, MessageStatus
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.files.store import LocalFileStore
from asterism.domains.knowledge.vector_store import LanceDbVectorStore, VectorChunk
from asterism.domains.user.models import UserModel
from migration_harness import upgrade_to

DIMENSION = 4
KEY = "backup-test-system-key-0123456789abcdef"


def _point(monkeypatch, root: Path) -> StorageLayout:
    monkeypatch.setattr(config, "storage_root", root)
    monkeypatch.setattr(config, "db_url", f"sqlite+aiosqlite:///{root / 'database.db'}")
    return StorageLayout(storage_root=root, backend_db=root / "database.db", auth_db=root / "users.db")


def _seed_auth(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute('CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT)')
        connection.execute("INSERT INTO \"user\" VALUES ('a', 'a@example.test')")


def _vectors(root: Path) -> LanceDbVectorStore:
    return LanceDbVectorStore(root / "knowledge" / "lancedb", dimension=DIMENSION, model_key="test")


def _chunk(file_id: str, ordinal: int) -> VectorChunk:
    return VectorChunk(
        id=f"{file_id}-{ordinal}",
        user_id="a",
        file_id=file_id,
        artifact_generation=1,
        chunk_ordinal=ordinal,
        kind="text",
        content=f"chunk {ordinal}",
        vector=[1.0, 0.0, 0.0, 0.0],
    )


@pytest_asyncio.fixture
async def instance(tmp_path, monkeypatch):
    """A migrated instance with one user, a theme, a model bundle and a vector table."""
    root = tmp_path / "storage"
    layout = _point(monkeypatch, root)
    await initialize_database()
    _seed_auth(layout.auth_db)
    (root / "themes").mkdir()
    (root / "themes" / "dusk.json").write_text('{"name": "Dusk"}\n')
    (root / "models" / "knowledge-clip" / "weights.bin").parent.mkdir(parents=True, exist_ok=True)
    (root / "models" / "knowledge-clip" / "weights.bin").write_bytes(b"model")
    await db_session_manager.init()
    async with get_async_db_session() as session:
        session.add(UserModel(id="a", name="Ada"))
        await session.commit()
    vectors = _vectors(root)
    await vectors.initialize()
    yield layout, vectors
    with contextlib.suppress(RuntimeError):  # some tests close it themselves
        await db_session_manager.close()


async def _chat_turns(stop: threading.Event, store: LocalFileStore, vectors: LanceDbVectorStore) -> int:
    """Behave like an active chat: streamed replies, produced files and knowledge vectors."""
    async with get_async_db_session() as session:
        chat = ChatModel(user_id="a", title="Busy chat")
        session.add(chat)
        await session.commit()
        chat_id = chat.id
    turns = 0
    while not stop.is_set() or turns < 3:
        async with get_async_db_session() as session:
            request = MessageModel(user_id="a", chat_id=chat_id, role="user", content=f"question {turns}")
            session.add(request)
            await session.flush()
            reply = MessageModel(
                user_id="a",
                chat_id=chat_id,
                role="assistant",
                content="",
                status=MessageStatus.PENDING,
                parent_message_id=request.id,
            )
            session.add(reply)
            await session.commit()
            for token in range(5):
                reply.content += f"token{token} "
                await session.commit()
            reply.status = MessageStatus.COMPLETED
            await session.commit()

            file_id = uuid.uuid4()
            content = f"produced {turns}".encode()
            key = store.save("a", file_id, ".txt", content)
            session.add(
                UserFileModel(
                    id=file_id,
                    user_id="a",
                    filename=f"notes-{turns}.txt",
                    original_name="notes.txt",
                    storage_key=key,
                    size=len(content),
                    mime_type="text/plain",
                    kind=FileKind.TEXT,
                    sha256=hashlib.sha256(content).hexdigest(),
                )
            )
            await session.commit()
        await vectors.add([_chunk(str(file_id), ordinal) for ordinal in range(3)])
        turns += 1
        await asyncio.sleep(0)
    return turns


@pytest.mark.asyncio
async def test_backup_during_an_active_chat_restores_to_a_working_instance(instance, tmp_path, monkeypatch):
    layout, vectors = instance
    store = LocalFileStore(layout.storage_root / "files")
    stop = threading.Event()
    writer = asyncio.create_task(_chat_turns(stop, store, vectors))
    await asyncio.sleep(0.2)

    monkeypatch.setenv("ASTERISM_COMMIT", "0123456789abcdef")
    archive = await asyncio.to_thread(create_backup, layout, tmp_path / "backups", system_key=KEY)
    stop.set()
    assert await writer >= 3
    with sqlite3.connect(layout.backend_db) as connection:
        (live_replies,) = connection.execute("SELECT count(*) FROM messages WHERE role = 'assistant'").fetchone()
    assert stat.S_IMODE(archive.stat().st_mode) == 0o600

    target = _point(monkeypatch, tmp_path / "restored")
    await db_session_manager.close()
    manifest = restore_backup(archive, target, system_key=KEY)
    assert manifest["schema_revision"] == head_revision()
    assert (manifest["app_version"], manifest["app_commit"]) == (app_version(), "0123456789abcdef")
    await initialize_database()
    await verify_database_revision()

    # Every snapshotted row is whole, and every file a row names was copied intact.
    with sqlite3.connect(target.backend_db) as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        replies = connection.execute(
            "SELECT content FROM messages WHERE role = 'assistant' AND status = 'completed'"
        ).fetchall()
        files = connection.execute("SELECT storage_key, sha256 FROM user_files").fetchall()
    assert replies and all(content.count("token") == 5 for (content,) in replies)
    assert len(replies) < live_replies, "the chat kept writing while the backup ran"
    restored_store = LocalFileStore(target.storage_root / "files")
    for storage_key, digest in files:
        data = await restored_store.read_bytes("a", storage_key)
        assert hashlib.sha256(data).hexdigest() == digest
    with sqlite3.connect(target.auth_db) as connection:
        assert connection.execute('SELECT email FROM "user"').fetchall() == [("a@example.test",)]
    assert (target.storage_root / "themes" / "dusk.json").read_text() == '{"name": "Dusk"}\n'
    bundle = target.storage_root / "models" / "knowledge-clip" / "weights.bin"
    assert not bundle.exists(), "model bundles are fetched again, not backed up"
    assert not list(target.storage_root.glob(".restore-*"))

    restored_vectors = _vectors(target.storage_root)
    await restored_vectors.initialize()
    rows = manifest["vector_tables"][f"{LanceDbVectorStore.TABLE_PREFIX}__test"]
    assert rows > 0 and rows % 3 == 0, "each turn's vectors are added in one commit"
    assert restored_vectors._require_table().count_rows() == rows  # pyright: ignore[reportPrivateUsage]


def _rewrite(archive: Path, destination: Path, change) -> Path:
    """Copy an archive member by member, letting ``change(name, data)`` alter or drop members."""
    with tarfile.open(archive, "r:gz") as source, tarfile.open(destination, "w:gz") as target:
        for member in source.getmembers():
            data = source.extractfile(member).read()  # pyright: ignore[reportOptionalMemberAccess]
            data = change(member.name, data)
            if data is None:
                continue
            member.size = len(data)
            target.addfile(member, io.BytesIO(data))
    return destination


@pytest_asyncio.fixture
async def archive(instance, tmp_path):
    layout, vectors = instance
    await vectors.add([_chunk("f", 0)])
    return create_backup(layout, tmp_path / "backups", system_key=KEY)


def _restore_target(tmp_path, monkeypatch) -> StorageLayout:
    return _point(monkeypatch, tmp_path / "restored")


def _assert_nothing_restored(layout: StorageLayout) -> None:
    assert not layout.backend_db.exists() and not layout.auth_db.exists()
    assert not layout.storage_root.exists() or not any(layout.storage_root.iterdir())


@pytest.mark.asyncio
async def test_a_member_that_does_not_match_its_checksum_is_refused(archive, tmp_path, monkeypatch):
    damaged = _rewrite(
        archive,
        tmp_path / "damaged.tar.gz",
        lambda name, data: b"tampered" if name == "themes/dusk.json" else data,
    )
    target = _restore_target(tmp_path, monkeypatch)
    with pytest.raises(BackupError, match="Checksum mismatch for themes/dusk.json"):
        restore_backup(damaged, target, system_key=KEY)
    _assert_nothing_restored(target)


@pytest.mark.asyncio
@pytest.mark.parametrize("cut", [0.5, 0.98])
async def test_a_truncated_archive_is_refused(archive, tmp_path, monkeypatch, cut):
    data = archive.read_bytes()
    truncated = tmp_path / "truncated.tar.gz"
    truncated.write_bytes(data[: int(len(data) * cut)])
    target = _restore_target(tmp_path, monkeypatch)
    with pytest.raises(BackupError, match="damaged"):
        restore_backup(truncated, target, system_key=KEY)
    _assert_nothing_restored(target)


@pytest.mark.asyncio
async def test_corrupted_bytes_and_missing_members_are_refused(archive, tmp_path, monkeypatch):
    data = bytearray(archive.read_bytes())
    data[len(data) // 2] ^= 0xFF
    flipped = tmp_path / "flipped.tar.gz"
    flipped.write_bytes(bytes(data))
    target = _restore_target(tmp_path, monkeypatch)
    with pytest.raises(BackupError, match="damaged"):
        restore_backup(flipped, target, system_key=KEY)
    _assert_nothing_restored(target)

    dropped = _rewrite(archive, tmp_path / "dropped.tar.gz", lambda name, data: None if name == MANIFEST else data)
    with pytest.raises(BackupError, match="no manifest"):
        restore_backup(dropped, target, system_key=KEY)

    without_theme = _rewrite(
        archive, tmp_path / "missing.tar.gz", lambda name, data: None if name.startswith("themes/") else data
    )
    with pytest.raises(BackupError, match="missing 1 file"):
        restore_backup(without_theme, target, system_key=KEY)
    _assert_nothing_restored(target)


@pytest.mark.asyncio
async def test_unsafe_member_paths_are_refused(archive, tmp_path, monkeypatch):
    escaping = tmp_path / "escaping.tar.gz"
    with tarfile.open(escaping, "w:gz") as tar:
        info = tarfile.TarInfo("files/../../outside.txt")
        info.size = 1
        tar.addfile(info, io.BytesIO(b"x"))
    target = _restore_target(tmp_path, monkeypatch)
    with pytest.raises(BackupError, match="unexpected entry"):
        restore_backup(escaping, target)
    assert not (tmp_path / "outside.txt").exists()
    _assert_nothing_restored(target)


def _with_revision(archive: Path, destination: Path, revision: str) -> Path:
    def change(name, data):
        if name == MANIFEST:
            manifest = json.loads(data)
            manifest["schema_revision"] = revision
            return json.dumps(manifest).encode()
        return data

    return _rewrite(archive, destination, change)


@pytest.mark.asyncio
async def test_a_backup_from_a_newer_revision_is_refused_naming_both(instance, tmp_path, monkeypatch):
    layout, _ = instance
    with sqlite3.connect(layout.backend_db) as connection:
        connection.execute("UPDATE alembic_version SET version_num = 'f00dcafe0001'")
    newer = create_backup(layout, tmp_path / "backups", system_key=KEY)
    target = _restore_target(tmp_path, monkeypatch)
    with pytest.raises(BackupError, match=f"revision f00dcafe0001.*this code is at {head_revision()}"):
        restore_backup(newer, target, system_key=KEY)
    _assert_nothing_restored(target)


@pytest.mark.asyncio
async def test_a_manifest_revision_that_disagrees_with_the_database_is_refused(archive, tmp_path, monkeypatch):
    older = next(script.revision for script in script_directory().walk_revisions() if script.down_revision is None)
    if older == head_revision():
        pytest.skip("needs at least two revisions")
    mismatched = _with_revision(archive, tmp_path / "mismatched.tar.gz", older)
    target = _restore_target(tmp_path, monkeypatch)
    with pytest.raises(BackupError, match="does not match the manifest"):
        restore_backup(mismatched, target, system_key=KEY)


@pytest.mark.asyncio
async def test_restore_refuses_a_different_system_key_and_a_non_empty_root(archive, tmp_path, monkeypatch):
    target = _restore_target(tmp_path, monkeypatch)
    with pytest.raises(BackupError, match="different SYSTEM_KEY"):
        restore_backup(archive, target, system_key="another-system-key-0123456789abcdef")
    _assert_nothing_restored(target)

    target.storage_root.mkdir(parents=True, exist_ok=True)
    (target.storage_root / "keep.txt").write_text("existing")
    with pytest.raises(BackupError, match="empty storage root"):
        restore_backup(archive, target, system_key=KEY)
    assert [path.name for path in target.storage_root.iterdir()] == ["keep.txt"]


def test_restore_applies_pending_migrations(tmp_path, monkeypatch):
    """A backup taken at an older known revision is upgraded by the restore command."""
    head = script_directory().get_revision(head_revision())
    if head is None or head.down_revision is None:
        pytest.skip("needs at least two revisions")
    previous = str(head.down_revision)
    layout = _point(monkeypatch, tmp_path / "storage")
    layout.storage_root.mkdir()
    asyncio.run(upgrade_to(layout.backend_db, previous))
    _seed_auth(layout.auth_db)
    archive = create_backup(layout, tmp_path / "backups", system_key=KEY)

    _point(monkeypatch, tmp_path / "restored")
    monkeypatch.setattr(config, "system_key", KEY)
    assert main(["restore", str(archive)]) == 0
    with sqlite3.connect(tmp_path / "restored" / "database.db") as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (head_revision(),)


@pytest.mark.asyncio
async def test_verify_checks_an_archive_without_restoring_it(archive, tmp_path, monkeypatch, capsys):
    target = _restore_target(tmp_path, monkeypatch)
    monkeypatch.setattr(config, "system_key", KEY)
    assert main(["verify", str(archive), "--scratch-dir", str(tmp_path)]) == 0
    assert "complete and restorable" in capsys.readouterr().out
    _assert_nothing_restored(target)
    assert not list(tmp_path.glob("asterism-verify-*"))

    damaged = _rewrite(archive, tmp_path / "damaged.tar.gz", lambda name, data: b"x" if name == AUTH_DB else data)
    assert main(["verify", str(damaged)]) == 1
    assert f"Checksum mismatch for {AUTH_DB}" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_cli_reports_refusals_without_a_traceback(archive, tmp_path, monkeypatch, capsys):
    _restore_target(tmp_path, monkeypatch)
    (tmp_path / "restored").mkdir()
    (tmp_path / "restored" / "busy").write_text("x")
    assert main(["restore", str(archive)]) == 1
    assert "restore refused: Restore needs an empty storage root" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_backups_stay_outside_storage_and_retention_keeps_the_newest(instance, tmp_path):
    layout, _ = instance
    with pytest.raises(BackupError, match="outside the storage root"):
        create_backup(layout, layout.storage_root / "backups")

    output = tmp_path / "backups"
    times = [datetime(2026, 11, day, 3, 0, tzinfo=UTC) for day in (15, 16, 17)]
    made = [create_backup(layout, output, now=moment, keep=2) for moment in times]
    (output / "unrelated.tar.gz").write_text("not ours")
    assert sorted(path.name for path in output.iterdir() if not path.name.startswith(".")) == sorted(
        [made[1].name, made[2].name, "unrelated.tar.gz"]
    )
    assert [path.name for path in prune(output, 1)] == [made[1].name]
    with pytest.raises(BackupError, match="already exists"):
        create_backup(layout, output, now=times[2])
    assert not list(output.glob(".*.partial")) and not list(output.glob(".asterism-backup-*/"))


@pytest.mark.asyncio
async def test_memory_vectors_are_backed_up_and_a_restore_rebuilds_the_missing_ones(instance, tmp_path, monkeypatch):
    """US-93.6: the memory table travels with the backup; a memory without a vector gets one."""
    from asterism.domains.memory import service as memory_service
    from asterism.domains.memory.models import MemoryCategory, MemoryKind, MemoryModel
    from asterism.domains.memory.rebuild import rebuild_memory_vectors
    from asterism.domains.memory.vectors import LanceDbMemoryVectorStore, MemoryVector

    layout, _ = instance
    embedded, missing = uuid.uuid4(), uuid.uuid4()
    async with get_async_db_session() as session:
        for memory_id, text in ((embedded, "Learns from diagrams"), (missing, "Reads with a screen reader")):
            session.add(
                MemoryModel(
                    id=memory_id, user_id="a", kind=MemoryKind.USER, text=text, category=MemoryCategory.LEARNING
                )
            )
        await session.commit()
    memories = LanceDbMemoryVectorStore(
        layout.storage_root / "knowledge" / "lancedb", dimension=DIMENSION, model_key="test"
    )
    await memories.write(
        MemoryVector(
            memory_id=str(embedded), user_id="a", kind="user", project_id="", revision=1, vector=[1.0, 0, 0, 0]
        )
    )
    archive = create_backup(layout, tmp_path / "backups", system_key=KEY)

    target = _point(monkeypatch, tmp_path / "restored")
    await db_session_manager.close()
    manifest = restore_backup(archive, target, system_key=KEY)
    assert manifest["vector_tables"][f"{LanceDbMemoryVectorStore.TABLE_PREFIX}__test"] == 1
    await initialize_database()
    await db_session_manager.init()

    class Embedding:
        def __init__(self):
            self.texts: list[str] = []

        async def embed_text(self, texts):
            self.texts.extend(texts)
            return [[0.0, 1.0, 0.0, 0.0] for _ in texts]

        embed_query = embed_passage = embed_text

    embedding = Embedding()
    restored = LanceDbMemoryVectorStore(
        target.storage_root / "knowledge" / "lancedb", dimension=DIMENSION, model_key="test"
    )
    monkeypatch.setattr(memory_service, "embedding_provider", embedding)
    monkeypatch.setattr(memory_service, "memory_vector_store", restored)
    assert await restored.list_revisions(user_id="a") == {str(embedded): 1}
    async with get_async_db_session() as session:
        result = await rebuild_memory_vectors(session)
    assert (result.rebuilt, result.failed, result.removed) == (1, 0, 0)
    assert embedding.texts == ["Reads with a screen reader"]
    assert await restored.list_revisions(user_id="a") == {str(embedded): 1, str(missing): 1}
