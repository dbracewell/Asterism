import asyncio
import uuid

import pytest
from asterism.core import config
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.store import get_file_store
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel
from asterism.domains.projects.models import ProjectFileModel
from sqlalchemy import select
from test_projects_api import auth, create
from test_projects_api import project_api as _project_api

project_api = _project_api


async def upload(client, name="source.txt", user="a", content=b"original bytes"):
    response = await client.post("/files/", headers=auth(user), files={"files": (name, content, "text/plain")})
    assert response.status_code == 201, response.text
    assert "storage_key" not in response.text
    return response.json()["files"][0]


async def change(client, project, ids, revision=1, method="POST", user="a"):
    return await client.request(
        method,
        f"/projects/{project['id']}/files",
        headers=auth(user),
        json={"file_ids": ids, "expected_context_revision": revision},
    )


@pytest.mark.asyncio
async def test_shared_sources_no_copy_no_processing_and_membership_summaries(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    monkeypatch.setattr("asterism.domains.knowledge.runtime.start_file_ingestion_job", lambda **_: True)
    first, second = await create(client, "First"), await create(client, "Second")
    file = await upload(client)
    async with sessions() as session:
        source = await session.get(UserFileModel, uuid.UUID(file["id"]))
        key = source.storage_key
        path = get_file_store().open("a", key)
        artifacts = list(await session.scalars(select(FileKnowledgeArtifactModel.id)))
    # Membership operations must not access bytes or enqueue extraction.
    monkeypatch.setattr(
        "asterism.domains.files.service.get_file_store",
        lambda: pytest.fail("Membership changed physical storage"),
    )
    monkeypatch.setattr(
        "asterism.domains.knowledge.runtime.start_file_ingestion_job",
        lambda **_: pytest.fail("Membership reprocessed source"),
    )
    for project in (first, second):
        result = await change(client, project, [file["id"], file["id"]])
        assert result.status_code == 200, result.text
        assert result.json() == {"context_revision": 2, "changed_file_ids": [file["id"]], "unchanged_file_ids": []}
        repeated = await change(client, project, [file["id"]], revision=2)
        assert repeated.json() == {"context_revision": 2, "changed_file_ids": [], "unchanged_file_ids": [file["id"]]}
    info = (await client.get(f"/files/info/{file['filename']}", headers=auth())).json()
    assert [p["name"] for p in info["projects"]] == ["First", "Second"]
    assert {p["context_revision"] for p in info["projects"]} == {2}
    renamed = await client.patch(
        f"/projects/{first['id']}",
        headers=auth(),
        json={"expected_context_revision": 2, "name": "Renamed"},
    )
    assert renamed.status_code == 200
    removed = await change(client, first, [file["id"]], revision=2, method="DELETE")
    assert removed.json()["context_revision"] == 3
    assert (await change(client, first, [file["id"]], revision=3, method="DELETE")).json()["unchanged_file_ids"] == [
        file["id"],
    ]
    assert (await client.get(f"/projects/{first['id']}/files", headers=auth())).json()["total"] == 0
    assert (await client.get(f"/projects/{second['id']}/files", headers=auth())).json()["files"][0]["id"] == file["id"]
    async with sessions() as session:
        source = await session.get(UserFileModel, uuid.UUID(file["id"]))
        assert source.storage_key == key
        assert list(await session.scalars(select(FileKnowledgeArtifactModel.id))) == artifacts
    assert path.read_bytes() == b"original bytes"
    assert len(list(config.files_root.rglob("source.*"))) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["POST", "DELETE"])
async def test_atomic_foreign_missing_stale_batches_and_deterministic_results(project_api, monkeypatch, method):
    client, _, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    project = await create(client)
    owned = [await upload(client, name=name) for name in ("z.txt", "a.txt")]
    foreign = await upload(client, user="b")
    ids = [file["id"] for file in owned]
    if method == "DELETE":
        assert (await change(client, project, ids)).status_code == 200
    revision = 2 if method == "DELETE" else 1
    for invalid in (foreign["id"], str(uuid.uuid4())):
        result = await change(client, project, [ids[0], invalid], revision=revision, method=method)
        assert result.status_code == 404
        assert (await client.get(f"/projects/{project['id']}", headers=auth())).json()["context_revision"] == revision
        assert (await client.get(f"/projects/{project['id']}/files", headers=auth())).json()["total"] == (
            2 if method == "DELETE" else 0
        )
    assert (await change(client, project, ids, revision=revision, method=method, user="b")).status_code == 404
    assert (await change(client, project, ids, revision=999, method=method)).status_code == 409
    result = await change(client, project, [ids[1], ids[0], ids[1]], revision=revision, method=method)
    assert result.json()["changed_file_ids"] == sorted(ids)
    assert result.json()["context_revision"] == revision + 1


@pytest.mark.asyncio
async def test_listing_pagination_search_owner_auth_validation_and_deletion_cleanup(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    first, second = await create(client, "First"), await create(client, "Second")
    files = [await upload(client, name=name) for name in ("z.txt", "a%_.txt", "unattached.txt")]
    ids = [file["id"] for file in files[:2]]
    for project in (first, second):
        assert (await change(client, project, ids)).status_code == 200
    path = f"/projects/{first['id']}/files"
    for method in ("GET", "POST", "DELETE"):
        kwargs = {} if method == "GET" else {"json": {"file_ids": ids, "expected_context_revision": 2}}
        assert (await client.request(method, path, **kwargs)).status_code == 401
    for invalid in (
        {},
        {"file_ids": [], "expected_context_revision": 2},
        {"file_ids": ["invalid"], "expected_context_revision": 2},
        {"file_ids": ids, "expected_context_revision": 0},
        {"file_ids": ids, "expected_context_revision": 2, "user_id": "b"},
    ):
        for method in ("POST", "DELETE"):
            assert (await client.request(method, path, headers=auth(), json=invalid)).status_code == 422
    assert (await client.get(path, headers=auth("b"))).status_code == 404
    for params in ({"page": 0}, {"page_size": 101}, {"sort_by": "invalid"}):
        assert (await client.get(path, headers=auth(), params=params)).status_code == 422
    pages = [
        (await client.get(path, headers=auth(), params={"page": page, "page_size": 1})).json() for page in (1, 2, 3)
    ]
    assert [p["total"] for p in pages] == [2, 2, 2]
    assert [p["files"][0]["filename"] for p in pages[:2]] == ["a%_.txt", "z.txt"]
    assert pages[2]["files"] == []
    assert (await client.get(path, headers=auth(), params={"query": "%_"})).json()["total"] == 1
    async with sessions() as session:
        source = await session.get(UserFileModel, uuid.UUID(ids[0]))
        source_path = get_file_store().open("a", source.storage_key)
    download = await client.get(f"/files/{files[0]['filename']}", headers=auth())
    assert download.content == b"original bytes"
    deletion = await client.delete(f"/files/{files[0]['filename']}", headers=auth())
    assert deletion.status_code == 200
    assert len(deletion.json()["projects"]) == 2
    assert not source_path.exists()
    for project in (first, second):
        assert (await client.get(f"/projects/{project['id']}", headers=auth())).json()["context_revision"] == 3
        assert (await client.get(f"/projects/{project['id']}/files", headers=auth())).json()["total"] == 1
    async with sessions() as session:
        assert (
            list(
                await session.scalars(
                    select(ProjectFileModel.file_id).where(ProjectFileModel.file_id == uuid.UUID(ids[0])),
                ),
            )
            == []
        )
        assert (
            list(
                await session.scalars(
                    select(FileKnowledgeArtifactModel.id).where(
                        FileKnowledgeArtifactModel.file_id == uuid.UUID(ids[0])
                    ),
                ),
            )
            == []
        )


@pytest.mark.asyncio
async def test_concurrent_membership_writes_have_one_winner(project_api, monkeypatch):
    client, _, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    project = await create(client)
    file = await upload(client)
    responses = await asyncio.gather(*[change(client, project, [file["id"]]) for _ in range(2)])
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert (await client.get(f"/projects/{project['id']}/files", headers=auth())).json()["total"] == 1
