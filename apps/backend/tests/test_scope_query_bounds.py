"""Scope resolution stays owner-filtered and uses constant SQL round trips."""

import time
import uuid

import pytest
from asterism.domains.chat.scope import resolve_chat_file_scope
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.projects.models import ProjectFileModel
from sqlalchemy import event
from test_context_tools import context_runtime as _context_runtime
from test_projects_api import project_api as _project_api

project_api = _project_api
context_runtime = _context_runtime


@pytest.mark.asyncio
@pytest.mark.parametrize("file_count", [10, 100, 1000])
async def test_project_scope_query_count_is_constant(context_runtime, file_count, record_property):
    r = context_runtime
    project_id = uuid.UUID(r.p["id"])
    included = set()
    async with r.sessions() as db:
        for owner, member in [("a", True), ("a", False), ("b", False)]:
            rows = [
                UserFileModel(
                    id=uuid.uuid4(),
                    user_id=owner,
                    storage_key=str(uuid.uuid4()),
                    filename=f"{owner}-{member}-{index}.txt",
                    original_name="source.txt",
                    size=1,
                    mime_type="text/plain",
                    kind=FileKind.TEXT,
                    sha256="a" * 64,
                )
                for index in range(file_count)
            ]
            db.add_all(rows)
            await db.flush()
            if member:
                included.update(file.id for file in rows)
                db.add_all(ProjectFileModel(project_id=project_id, user_id=owner, file_id=file.id) for file in rows)
        await db.commit()
    statements = []
    engine = r.sessions.kw["bind"].sync_engine

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    start = time.perf_counter()
    try:
        async with r.sessions() as db:
            result = await resolve_chat_file_scope(user_id="a", chat_id=r.chat_id, session=db)
    finally:
        elapsed = time.perf_counter() - start
        event.remove(engine, "before_cursor_execute", capture)
    assert set(result.allowed_file_ids) == included
    assert all(file.sources == ["project"] for file in result.files)
    # Chat identity, branch messages, local sources, project identity, project
    # sources, selected targets: six selects regardless of membership count.
    assert len(statements) == 6
    assert all(statement.lstrip().upper().startswith("SELECT") for statement in statements)
    record_property("project_files", file_count)
    record_property("library_files", file_count * 3)
    record_property("scope_queries", len(statements))
    record_property("scope_seconds", round(elapsed, 6))
    print(f"scope: project={file_count} library={file_count * 3} selects={len(statements)} seconds={elapsed:.6f}")
