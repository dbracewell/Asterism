"""US-119.1: uploads and stored files don't block the event loop."""

import asyncio
import hashlib
import os
import threading
import uuid
from io import BytesIO

import pytest
import pytest_asyncio
from asterism.core import config
from asterism.db.model_registry import Base
from asterism.domains.files import processor
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.processor import ensure_file_processed
from asterism.domains.files.service import upload_files
from asterism.domains.files.store import LocalFileStore, get_file_store, save_off_loop
from asterism.domains.user.models import UserModel
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.datastructures import UploadFile

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def file_session(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "storage_root", tmp_path)
    monkeypatch.setattr("asterism.domains.files.service.start_ingestion", lambda **_: None, raising=False)
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'files.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add(UserModel(id="user-a"))
        await session.commit()
        yield session
    await engine.dispose()


async def _upload(session, name: str, content: bytes) -> UserFileModel:
    uploaded = await upload_files(
        user_id="user-a", uploads=[UploadFile(filename=name, file=BytesIO(content))], session=session
    )
    record = await session.get(UserFileModel, uploaded.files[0].id)
    assert record is not None
    return record


async def test_an_upload_is_hashed_and_written_outside_the_event_loop(file_session, monkeypatch):
    loop_thread = threading.get_ident()
    threads: dict[str, int] = {}
    real_sha256, real_save = hashlib.sha256, LocalFileStore.save

    def sha256(*args, **kwargs):
        threads.setdefault("hash", threading.get_ident())
        return real_sha256(*args, **kwargs)

    def save(self, *args, **kwargs):
        threads["save"] = threading.get_ident()
        return real_save(self, *args, **kwargs)

    monkeypatch.setattr(hashlib, "sha256", sha256)
    monkeypatch.setattr(LocalFileStore, "save", save)

    record = await _upload(file_session, "big.txt", b"x" * (4 * 1024 * 1024))

    assert record.sha256 == real_sha256(b"x" * (4 * 1024 * 1024)).hexdigest()
    assert threads.keys() == {"hash", "save"}
    assert loop_thread not in threads.values()


async def test_a_save_cancelled_mid_write_leaves_nothing_behind(tmp_path):
    started, release = threading.Event(), threading.Event()

    class SlowStore(LocalFileStore):
        def save(self, *args, **kwargs):
            started.set()
            release.wait(5)
            return super().save(*args, **kwargs)

    store = SlowStore(tmp_path / "files")
    task = asyncio.create_task(save_off_loop(store, "user-a", uuid.uuid4(), ".txt", b"partial"))
    assert await asyncio.to_thread(started.wait, 5)
    # The loop keeps running while the thread writes.
    await asyncio.sleep(0)
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert [path for path in (tmp_path / "files").rglob("*") if path.is_file()] == []


async def test_a_ready_file_is_not_hashed_again_until_it_changes(file_session, monkeypatch):
    hashed: list[str] = []
    real = processor.sha256_file

    def counting(path):
        hashed.append(path.name)
        return real(path)

    monkeypatch.setattr(processor, "sha256_file", counting)
    record = await _upload(file_session, "note.txt", b"hello")

    first = await ensure_file_processed(file=record, session=file_session)
    again = await ensure_file_processed(file=first, session=file_session)
    assert again.content_cache == "hello"
    assert len(hashed) == 1

    # Same length, timestamps put back: the change time still moves, so the
    # replacement is caught.
    path = get_file_store().local_path(record.user_id, record.storage_key)
    before = path.stat()
    path.write_bytes(b"world")
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))

    replaced = await ensure_file_processed(file=again, session=file_session)
    assert len(hashed) == 2
    assert replaced.content_cache == "world"
    assert replaced.sha256 == hashlib.sha256(b"world").hexdigest()
