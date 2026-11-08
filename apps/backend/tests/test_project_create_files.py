"""Creating a project with library files is one all-or-nothing request (US-65.3)."""

import uuid

import pytest
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.projects.models import ProjectFileModel, ProjectModel
from sqlalchemy import func, select
from test_projects_api import auth, create
from test_projects_api import project_api as _project_api

project_api = _project_api


async def library_file(sessions, user="a", name="notes.txt"):
    async with sessions() as db:
        file = UserFileModel(
            storage_key=str(uuid.uuid4()),
            user_id=user,
            filename=name,
            original_name=name,
            size=1,
            mime_type="text/plain",
            kind=FileKind.TEXT,
            sha256="a" * 64,
        )
        db.add(file)
        await db.commit()
        return str(file.id)


async def counts(sessions):
    async with sessions() as db:
        return (
            await db.scalar(select(func.count()).select_from(ProjectModel)),
            await db.scalar(select(func.count()).select_from(ProjectFileModel)),
        )


@pytest.mark.asyncio
async def test_create_adds_chosen_library_files(project_api):
    client, sessions, _ = project_api
    first, second = await library_file(sessions), await library_file(sessions, name="two.txt")
    project = await create(client, "Course", file_ids=[first, second, first])
    assert project["context_revision"] == 1
    listed = await client.get(f"/projects/{project['id']}/files", headers=auth())
    assert listed.status_code == 200, listed.text
    assert sorted(file["id"] for file in listed.json()["files"]) == sorted([first, second])


@pytest.mark.asyncio
async def test_a_foreign_file_or_taken_name_creates_nothing(project_api):
    client, sessions, _ = project_api
    mine, theirs = await library_file(sessions), await library_file(sessions, user="b")
    await create(client, "Taken")
    before = await counts(sessions)

    foreign = await client.post("/projects/", headers=auth(), json={"name": "New", "file_ids": [mine, theirs]})
    assert foreign.status_code == 404
    missing = await client.post("/projects/", headers=auth(), json={"name": "New", "file_ids": [str(uuid.uuid4())]})
    assert missing.status_code == 404
    taken = await client.post("/projects/", headers=auth(), json={"name": "Taken", "file_ids": [mine]})
    assert taken.status_code == 409
    assert await counts(sessions) == before
