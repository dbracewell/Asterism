from io import BytesIO

import pytest
import pytest_asyncio
from asterism.core import config
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.db.base import Base
from asterism.db.schema_migrations import run_schema_migrations
from asterism.domains.files.models import FileContentStatus, FileKind, UserFileModel
from asterism.domains.files.processor import MarkItDownFileProcessor
from asterism.domains.files.service import (
    delete_user_file,
    ensure_file_processed,
    get_user_file,
    list_user_files,
    upload_files,
)
from asterism.domains.user.models import UserModel
from openpyxl import Workbook
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


@pytest.mark.asyncio
async def test_processing_reads_text_caches_and_invalidates(file_session):
    uploaded = await upload_files(
        user_id="user-a", uploads=[_upload("note.txt", b"hello\nworld")], session=file_session
    )
    file = await file_session.get(UserFileModel, uploaded.files[0].id)
    assert file is not None

    processed = await ensure_file_processed(file=file, session=file_session)
    assert processed.content_status is FileContentStatus.READY
    assert processed.content_cache == "hello\nworld"

    path = config.files_root / "user-a" / processed.filename
    path.write_text("changed", encoding="utf-8")
    processed = await ensure_file_processed(file=processed, session=file_session)
    assert processed.content_cache == "changed"


@pytest.mark.asyncio
async def test_processing_bounds_and_unsupported_files(file_session, monkeypatch):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("large.txt", b"content"), _upload("unknown.dat", b"binary")],
        session=file_session,
    )
    monkeypatch.setattr(config, "max_process_file_size_bytes", 3)
    large = await file_session.get(UserFileModel, uploaded.files[0].id)
    unknown = await file_session.get(UserFileModel, uploaded.files[1].id)
    assert large is not None and unknown is not None

    processed_large = await ensure_file_processed(file=large, session=file_session)
    processed_unknown = await ensure_file_processed(file=unknown, session=file_session)
    assert processed_large.content_error == "File is too large to process"
    assert processed_unknown.content_status is FileContentStatus.UNSUPPORTED


def _xlsx_bytes() -> bytes:
    workbook = Workbook()
    workbook.active.append(["Column", "Spreadsheet content"])
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()



@pytest.mark.asyncio
async def test_processing_converts_html_document(file_session):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("page.html", b"<h1>Heading</h1><p>Hello document</p>")],
        session=file_session,
    )
    file = await file_session.get(UserFileModel, uploaded.files[0].id)
    assert file is not None and file.kind is FileKind.DOCUMENT

    processed = await ensure_file_processed(file=file, session=file_session)
    assert processed.content_status is FileContentStatus.READY
    assert "Heading" in (processed.content_cache or "")
    assert "Hello document" in (processed.content_cache or "")


@pytest.mark.asyncio
async def test_processing_converts_a_spreadsheet_document(file_session):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("spreadsheet.xlsx", _xlsx_bytes())],
        session=file_session,
    )
    expected_content = ["Spreadsheet content"]
    for metadata, expected in zip(uploaded.files, expected_content, strict=True):
        file = await file_session.get(UserFileModel, metadata.id)
        assert file is not None and file.kind is FileKind.DOCUMENT
        processed = await ensure_file_processed(file=file, session=file_session)
        assert processed.content_status is FileContentStatus.READY
        assert expected in (processed.content_cache or "")


@pytest.mark.asyncio
async def test_processing_truncates_content_and_contains_converter_failures(
    file_session, monkeypatch
):
    uploaded = await upload_files(
        user_id="user-a", uploads=[_upload("note.txt", b"abcdef")], session=file_session
    )
    monkeypatch.setattr(config, "max_converted_chars", 4)
    file = await file_session.get(UserFileModel, uploaded.files[0].id)
    assert file is not None
    processed = await ensure_file_processed(file=file, session=file_session)
    assert processed.content_cache == "abcd\n… [content truncated]"

    document = await upload_files(
        user_id="user-a", uploads=[_upload("broken.pdf", b"not really a PDF")], session=file_session
    )

    async def timeout(_, __):
        raise TimeoutError

    monkeypatch.setattr(MarkItDownFileProcessor, "_convert_with_timeout", timeout)
    file = await file_session.get(UserFileModel, document.files[0].id)
    assert file is not None
    processed = await ensure_file_processed(file=file, session=file_session)
    assert processed.content_status is FileContentStatus.FAILED
    assert processed.content_error == "File conversion timed out"


@pytest.mark.asyncio
async def test_processing_handles_a_missing_file(file_session):
    uploaded = await upload_files(
        user_id="user-a", uploads=[_upload("missing.txt", b"content")], session=file_session
    )
    file = await file_session.get(UserFileModel, uploaded.files[0].id)
    assert file is not None
    (config.files_root / "user-a" / file.filename).unlink()

    processed = await ensure_file_processed(file=file, session=file_session)
    assert processed.content_status is FileContentStatus.FAILED
    assert processed.content_error == "File is no longer available"


def test_download_rejects_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "storage_root", tmp_path)
    with pytest.raises(BadDataException):
        get_user_file("user-a", "../secret.txt")
