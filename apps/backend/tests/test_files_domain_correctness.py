"""Correctness fixes in the files domain.

Covers the four defects found while reviewing the domain:

- a replaced source whose length did not change left a stale content cache
  and a stale download ETag;
- an empty source was reported to the model as an unsupported file type;
- a completed delete could still fail because the stored source was removed
  after the database commit;
- the file table carried a constraint and an index that could never do any
  work.
"""

import uuid
from contextlib import asynccontextmanager
from io import BytesIO

import pytest
import pytest_asyncio
from asterism.common.hashing import sha256_file
from asterism.core import config
from asterism.db.model_registry import Base
from asterism.domains.agent.execution_scope import ExecutionScope
from asterism.domains.files.models import FileContentStatus, UserFileModel
from asterism.domains.files.processor import ensure_file_processed
from asterism.domains.files.runtime_access import RuntimeFileReader
from asterism.domains.files.service import delete_user_file, upload_files
from asterism.domains.files.store import get_file_store
from asterism.domains.user.models import UserModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.datastructures import UploadFile


@pytest_asyncio.fixture
async def file_session(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "storage_root", tmp_path)
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'files.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all([UserModel(id="user-a"), UserModel(id="user-b")])
        await session.commit()
        yield session
    await engine.dispose()


def _upload(name: str, content: bytes) -> UploadFile:
    return UploadFile(filename=name, file=BytesIO(content))


# --------------------------------------------------------------------------
# 1. A replaced source invalidates the cached content
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_same_size_replacement_invalidates_the_cached_content(file_session):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("note.txt", b"hello")],
        session=file_session,
    )
    record = await file_session.get(UserFileModel, uploaded.files[0].id)
    assert record is not None

    processed = await ensure_file_processed(file=record, session=file_session)
    assert processed.content_cache == "hello"

    # Replace the source with different bytes of exactly the same length.
    path = get_file_store().open(processed.user_id, processed.storage_key)
    path.write_bytes(b"world")
    assert path.stat().st_size == processed.size

    record = await file_session.get(UserFileModel, uploaded.files[0].id)
    assert record is not None
    reprocessed = await ensure_file_processed(file=record, session=file_session)

    # The cache and the recorded digest must follow the bytes on disk.
    assert reprocessed.content_cache == "world"
    assert reprocessed.sha256 == sha256_file(path)
    assert reprocessed.size == path.stat().st_size


@pytest.mark.asyncio
async def test_unchanged_source_keeps_its_cached_content(file_session):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("stable.txt", b"unchanged")],
        session=file_session,
    )
    record = await file_session.get(UserFileModel, uploaded.files[0].id)
    assert record is not None

    first = await ensure_file_processed(file=record, session=file_session)
    digest = first.sha256
    again = await ensure_file_processed(file=first, session=file_session)

    assert again.content_cache == "unchanged"
    assert again.sha256 == digest
    assert again.content_status is FileContentStatus.READY


# --------------------------------------------------------------------------
# 2. An empty source is an attached source
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_text_source_is_read_as_content_not_as_unsupported(file_session, monkeypatch):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("empty.txt", b"")],
        session=file_session,
    )
    file_id = uploaded.files[0].id
    record = await file_session.get(UserFileModel, file_id)
    assert record is not None
    processed = await ensure_file_processed(file=record, session=file_session)
    assert processed.content_status is FileContentStatus.READY
    assert processed.content_cache == ""

    @asynccontextmanager
    async def session_context(session=None):
        yield session or file_session

    monkeypatch.setattr("asterism.domains.files.runtime_access.get_async_db_session", session_context)

    async def authorize(_scope):
        return frozenset({file_id})

    async def process(file, db):
        return await ensure_file_processed(file=file, session=db)

    reader = RuntimeFileReader(
        authorize=authorize,
        store=get_file_store(),
        max_image_bytes=config.max_vision_image_bytes,
        process_file=process,
    )
    scope = ExecutionScope(
        user_id="user-a",
        user_profile_id=None,
        agent_id=uuid.uuid4(),
        is_sub_agent=False,
        chat_id=uuid.uuid4(),
        project_id=None,
        selected_model=None,
        executed_model=None,
        eligible_sub_agent_ids=frozenset(),
        effective_internal_tools=frozenset(),
        active_branch_message_ids=(),
        configuration_revision=1,
        prompt_revision=None,
        allowed_file_ids=frozenset({file_id}),
        file_provenance=(),
    )

    payload = await reader.read_for_model(scope, file_id, supports_vision=False)

    # An empty cache is still cached content, not a missing or unsupported one.
    assert payload.text == ""
    assert payload.reason is None
    assert payload.image_url is None


# --------------------------------------------------------------------------
# 3. A completed delete does not fail on the stored source
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_succeeds_when_the_stored_source_cannot_be_removed(file_session, monkeypatch):
    uploaded = await upload_files(
        user_id="user-a",
        uploads=[_upload("doomed.txt", b"content")],
        session=file_session,
    )
    filename = uploaded.files[0].filename

    class FailingStore:
        def open(self, user_id, storage_key):
            return get_file_store().open(user_id, storage_key)

        def delete(self, user_id, storage_key):
            raise OSError("source is locked")

    monkeypatch.setattr("asterism.domains.files.service.get_file_store", lambda: FailingStore())

    deleted = await delete_user_file(user_id="user-a", filename=filename, session=file_session)

    assert deleted.filename == filename
    assert await file_session.scalar(select(UserFileModel.id)) is None


# --------------------------------------------------------------------------
# 4. The file table carries no dead constraints or indexes
# --------------------------------------------------------------------------


def test_file_table_has_no_redundant_index():
    constraint_names = {constraint.name for constraint in UserFileModel.__table__.constraints}
    index_names = {index.name for index in UserFileModel.__table__.indexes}

    # The unique constraint on (user_id, filename) already creates that
    # index, so a second index on the same columns is pure overhead.
    assert "idx_user_files_user_filename" not in index_names
    assert "uq_user_files_user_filename" in constraint_names
    # The composite foreign keys from chat_files, chat_draft_files and
    # project_files reference (id, user_id); SQLite needs a unique constraint
    # on exactly those parent columns.
    assert "uq_user_files_id_user" in constraint_names
