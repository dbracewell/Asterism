from io import BytesIO

import pytest
import pytest_asyncio
from asterism.core import config
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.db.base import Base
from asterism.db.schema_migrations import run_schema_migrations
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.files.service import (
    delete_user_file,
    get_user_file,
    list_user_files,
    upload_files,
)
from asterism.domains.user.models import UserModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.datastructures import UploadFile


def _upload(name: str, content: bytes) -> UploadFile:
    return UploadFile(filename=name, file=BytesIO(content))


@pytest_asyncio.fixture
async def file_session(tmp_path, monkeypatch):
    database = tmp_path / "files.db"
    monkeypatch.setattr(config, "storage_root", tmp_path)
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await run_schema_migrations(connection)
        await run_schema_migrations(connection)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all([UserModel(id="user-a"), UserModel(id="user-b")])
        await session.commit()
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_upload_deduplicates_classifies_and_scopes_files(file_session):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[
            _upload("../report.txt", b"first"),
            _upload("report.txt", b"second"),
            _upload("photo.png", b"\x89PNG\r\n\x1a\ncontent"),
        ],
        session=file_session,
    )

    assert [file.filename for file in uploaded.files] == [
        "report.txt", "report(2).txt", "photo.png"
    ]
    assert [file.kind for file in uploaded.files] == [
        FileKind.TEXT, FileKind.TEXT, FileKind.IMAGE,
    ]
    assert uploaded.files[0].mime_type == "text/plain"
    assert uploaded.files[2].mime_type == "image/png"
    assert (config.files_root / "user-a" / "report.txt").read_bytes() == b"first"
    assert (await list_user_files(user_id="user-b", session=file_session)).files == []


@pytest.mark.asyncio
async def test_upload_rejects_unsafe_extensions_and_size(file_session, monkeypatch):
    with pytest.raises(BadDataException, match="not allowed"):
        await upload_files(
            user_id="user-a", uploads=[_upload("bad.exe", b"x")], session=file_session
        )

    monkeypatch.setattr(config, "max_upload_file_size_bytes", 3)
    with pytest.raises(BadDataException, match="exceeds"):
        await upload_files(
            user_id="user-a", uploads=[_upload("large.txt", b"four")], session=file_session
        )
    assert not (config.files_root / "user-a" / "large.txt").exists()


@pytest.mark.asyncio
async def test_delete_is_user_scoped_and_download_remains_available(file_session):
    uploaded = await upload_files(
        user_id="user-a", uploads=[_upload("keep.txt", b"content")], session=file_session
    )
    filename = uploaded.files[0].filename

    with pytest.raises(NotFoundException):
        await delete_user_file(user_id="user-b", filename=filename, session=file_session)

    response = get_user_file("user-a", filename)
    assert response.path == config.files_root / "user-a" / filename
    deleted = await delete_user_file(user_id="user-a", filename=filename, session=file_session)
    assert deleted.filename == filename
    assert not (config.files_root / "user-a" / filename).exists()
    assert await file_session.scalar(select(UserFileModel.id)) is None


def test_download_rejects_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "storage_root", tmp_path)
    with pytest.raises(BadDataException):
        get_user_file("user-a", "../secret.txt")
