import asyncio
import uuid
from contextlib import asynccontextmanager

import httpx
import pytest
import pytest_asyncio
from asterism.core.exceptions import CodedException, UnauthorizedException
from asterism.core.schemas import AuthedUser
from asterism.db.base import Base
from asterism.db.database import set_sqlite_pragma
from asterism.db.dependencies import get_db_session
from asterism.domains.extraction.models import FileExtractionModel
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.files.store import LocalFileStore
from asterism.domains.projects.models import ProjectFileModel, ProjectModel
from asterism.domains.projects.service import advance_context_revision
from asterism.domains.settings.models import LLMModel, ProviderModel
from asterism.domains.user.models import UserModel
from asterism.main import app
from sqlalchemy import event, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def project_api(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'projects.db'}")
    event.listen(engine.sync_engine, "connect", set_sqlite_pragma)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all([UserModel(id="a"), UserModel(id="b")])
        provider = ProviderModel(name="Chat test provider", base_url="http://localhost/v1", api_key="test")
        session.add(provider)
        await session.flush()
        session.add_all(
            [
                LLMModel(id=uuid.UUID(int=1), provider_id=provider.id, name="Chat A", is_active=True),
                LLMModel(id=uuid.UUID(int=2), provider_id=provider.id, name="Chat B", is_active=True),
            ],
        )
        await session.commit()

    @asynccontextmanager
    async def session_context(session=None):
        if session is not None:
            yield session
        else:
            async with sessions() as session:
                yield session

    for module in ["chat.tool_policy", "chat.delegation", "agent.service"]:
        monkeypatch.setattr(f"asterism.domains.{module}.get_async_db_session", session_context)

    async def db():
        async with sessions() as session:
            yield session

    def verify_token(token):
        if token not in ("a", "b"):
            raise UnauthorizedException()
        return AuthedUser(id=token, email=f"{token}@example.test", name=token, role="user")

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", verify_token)
    app.dependency_overrides[get_db_session] = db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            yield client, sessions, tmp_path
    finally:
        app.dependency_overrides.pop(get_db_session, None)
        await engine.dispose()


def auth(user="a"):
    return {"Authorization": f"Bearer {user}"}


async def create(client, name="Project", **fields):
    response = await client.post("/projects/", headers=auth(), json={"name": name, **fields})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_create_read_update_delete_lifecycle(project_api):
    client, _, _ = project_api
    project = await create(client, name="  Course work  ", description="", system_prompt="")
    assert project["name"] == "Course work"
    assert project["context_revision"] == 1
    path = f"/projects/{project['id']}"
    assert (await client.get(path, headers=auth())).json() == project
    updated = await client.patch(
        path,
        headers=auth(),
        json={
            "expected_context_revision": 1,
            "system_prompt": "Explain carefully",
            "description": "Classes",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["context_revision"] == 2
    cleared = await client.patch(
        path,
        headers=auth(),
        json={
            "expected_context_revision": 2,
            "system_prompt": "",
            "description": "",
        },
    )
    assert cleared.status_code == 200
    assert cleared.json()["context_revision"] == 3
    deleted = await client.delete(path, headers=auth(), params={"expected_context_revision": 3})
    assert deleted.status_code == 200
    assert deleted.json() == cleared.json()
    assert (await client.get(path, headers=auth())).status_code == 404


@pytest.mark.asyncio
async def test_owner_isolation_and_same_name_for_different_owners(project_api):
    client, _, _ = project_api
    project = await create(client)
    path = f"/projects/{project['id']}"
    for target in (path, f"/projects/{uuid.uuid4()}"):
        responses = [
            await client.get(target, headers=auth("b")),
            await client.patch(target, headers=auth("b"), json={"expected_context_revision": 1, "name": "Other"}),
            await client.delete(target, headers=auth("b"), params={"expected_context_revision": 1}),
        ]
        assert [(r.status_code, r.json()) for r in responses] == [
            (404, {"code": 404, "detail": "Project not found"}),
        ] * 3
    assert (await client.get("/projects/", headers=auth("b"))).json()["total"] == 0
    assert (await client.post("/projects/", headers=auth("b"), json={"name": "Project"})).status_code == 201
    assert (await client.get(path, headers=auth())).json() == project


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "method,path,kwargs",
    [
        ("GET", "/projects/", {}),
        ("POST", "/projects/", {"json": {"name": "X"}}),
        ("GET", f"/projects/{uuid.uuid4()}", {}),
        ("PATCH", f"/projects/{uuid.uuid4()}", {"json": {"expected_context_revision": 1}}),
        ("DELETE", f"/projects/{uuid.uuid4()}", {"params": {"expected_context_revision": 1}}),
    ],
)
async def test_all_routes_require_auth(project_api, method, path, kwargs):
    client, _, _ = project_api
    for headers in ({}, auth("invalid")):
        response = await client.request(method, path, headers=headers, **kwargs)
        assert response.status_code == 401
        assert response.json()["code"] == 401


@pytest.mark.asyncio
async def test_duplicate_names_conflict_and_failed_update_is_atomic(project_api):
    client, _, _ = project_api
    first = await create(client, name="First")
    second = await create(client, name="Second")
    assert (await client.post("/projects/", headers=auth(), json={"name": " First "})).status_code == 409
    path = f"/projects/{second['id']}"
    result = await client.patch(
        path,
        headers=auth(),
        json={
            "expected_context_revision": 1,
            "name": first["name"],
            "system_prompt": "must roll back",
        },
    )
    assert result.status_code == 409
    assert (await client.get(path, headers=auth())).json() == second


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"name": ""},
        {"name": " \n\t "},
        {"name": "x" * 256},
        {"name": None},
        {"name": "X", "description": None},
        {"name": "X", "system_prompt": None},
        {"name": "X", "description": "x" * 10_001},
        {"name": "X", "system_prompt": "x" * 100_001},
        {"name": "X", "user_id": "b"},
        {"name": "X", "context_revision": 10},
    ],
)
async def test_create_validation(project_api, payload):
    client, _, _ = project_api
    response = await client.post("/projects/", headers=auth(), json=payload)
    assert response.status_code == 422
    assert (await client.get("/projects/", headers=auth())).json()["total"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fields",
    [
        {},
        {"expected_context_revision": 0},
        {"expected_context_revision": None},
        {"name": ""},
        {"name": None},
        {"description": None},
        {"system_prompt": None},
        {"name": "x" * 256},
        {"description": "x" * 10_001},
        {"system_prompt": "x" * 100_001},
        {"context_revision": 20},
        {"user_id": "b"},
    ],
)
async def test_patch_validation(project_api, fields):
    client, _, _ = project_api
    project = await create(client)
    path = f"/projects/{project['id']}"
    payload = {"expected_context_revision": 1, **fields} if fields else {}
    assert (await client.patch(path, headers=auth(), json=payload)).status_code == 422
    assert (await client.get(path, headers=auth())).json() == project


@pytest.mark.asyncio
async def test_revision_guards_noops_and_metadata_updates(project_api):
    client, _, _ = project_api
    project = await create(client)
    path = f"/projects/{project['id']}"
    omitted = await client.patch(path, headers=auth(), json={"expected_context_revision": 1})
    assert omitted.status_code == 200
    assert omitted.json() == project
    unchanged = await client.patch(path, headers=auth(), json={"expected_context_revision": 1, "system_prompt": ""})
    assert unchanged.json() == project
    renamed = await client.patch(path, headers=auth(), json={"expected_context_revision": 1, "name": "Renamed"})
    assert renamed.json()["context_revision"] == 1
    changed = await client.patch(path, headers=auth(), json={"expected_context_revision": 1, "system_prompt": "new"})
    assert changed.json()["context_revision"] == 2
    for payload in ({"name": "stale"}, {"system_prompt": "stale"}, {}):
        response = await client.patch(path, headers=auth(), json={"expected_context_revision": 1, **payload})
        assert response.status_code == 409
    assert (await client.delete(path, headers=auth(), params={"expected_context_revision": 1})).status_code == 409
    assert (await client.get(path, headers=auth())).json() == changed.json()
    assert (await client.delete(path, headers=auth())).status_code == 422
    assert (await client.delete(path, headers=auth(), params={"expected_context_revision": 0})).status_code == 422


@pytest.mark.asyncio
async def test_listing_literal_search_pagination_and_stable_ties(project_api):
    client, sessions, _ = project_api
    records = [
        await create(client, name=name, description=description)
        for name, description in [
            ("Zeta", "Course material"),
            ("Alpha", "Math"),
            ("50%_report", "Literal markers"),
        ]
    ]
    await client.post("/projects/", headers=auth("b"), json={"name": "Foreign", "description": "Course"})
    async with sessions() as session:
        await session.execute(update(ProjectModel).values(created_at=100, updated_at=100))
        await session.commit()
    for sort in ("name", "created", "updated"):
        ids = []
        for page in range(1, 4):
            result = await client.get(
                "/projects/",
                headers=auth(),
                params={"sort_by": sort, "page": page, "page_size": 1},
            )
            assert result.status_code == 200
            assert result.json()["total"] == 3
            ids.extend(item["id"] for item in result.json()["projects"])
        expected = (
            [records[2]["id"], records[1]["id"], records[0]["id"]]
            if sort == "name"
            else sorted(record["id"] for record in records)
        )
        assert ids == expected
    for query, names in [(" COURSE ", ["Zeta"]), ("%_", ["50%_report"]), ("alpha", ["Alpha"]), ("missing", [])]:
        result = await client.get("/projects/", headers=auth(), params={"query": query})
        assert [item["name"] for item in result.json()["projects"]] == names
    assert (await client.get("/projects/", headers=auth(), params={"page": 9})).json()["projects"] == []
    assert (await client.get("/projects/", headers=auth(), params={"query": "   "})).json()["total"] == 3
    for params in ({"page": 0}, {"page_size": 0}, {"page_size": 101}, {"sort_by": "invalid"}):
        assert (await client.get("/projects/", headers=auth(), params=params)).status_code == 422


@pytest.mark.asyncio
async def test_deletion_retains_shared_source_bytes_and_extraction(project_api):
    client, sessions, tmp_path = project_api
    first, second = await create(client, name="First"), await create(client, name="Second")
    # Exercise the existing source abstraction; project deletion never invokes it.
    store = LocalFileStore(tmp_path / "sources")
    source_id = uuid.uuid4()
    source_key = store.save("a", source_id, ".txt", b"keep these original bytes")
    async with sessions() as session:
        file = UserFileModel(
            id=source_id,
            storage_key=source_key,
            user_id="a",
            filename="source.txt",
            original_name="source.txt",
            size=25,
            mime_type="text/plain",
            kind=FileKind.TEXT,
            sha256="a" * 64,
        )
        session.add(file)
        await session.flush()
        session.add_all(
            [ProjectFileModel(project_id=uuid.UUID(p["id"]), file_id=file.id, user_id="a") for p in (first, second)],
        )
        session.add(
            FileExtractionModel(
                user_id="a",
                file_id=file.id,
                generation=1,
                processing_profile_generation=1,
                processing_profile_identity="a" * 64,
            ),
        )
        await session.commit()
        file_id = file.id
    assert (
        await client.delete(f"/projects/{first['id']}", headers=auth(), params={"expected_context_revision": 1})
    ).status_code == 200
    async with sessions() as session:
        assert await session.get(UserFileModel, file_id) is not None
        assert len((await session.scalars(select(FileExtractionModel))).all()) == 1
        memberships = (await session.scalars(select(ProjectFileModel))).all()
        assert [m.project_id for m in memberships] == [uuid.UUID(second["id"])]
    assert store.open("a", source_key).read_bytes() == b"keep these original bytes"


@pytest.mark.asyncio
async def test_membership_revision_is_transactional_and_guards_stale_updates(project_api):
    client, sessions, _ = project_api
    project = await create(client)
    project_id = uuid.UUID(project["id"])
    async with sessions() as session:
        assert (
            await advance_context_revision(
                user_id="a",
                project_id=project_id,
                expected_context_revision=1,
                session=session,
            )
            == 2
        )
        await session.rollback()
    assert (await client.get(f"/projects/{project_id}", headers=auth())).json()["context_revision"] == 1
    async with sessions() as session:
        assert (
            await advance_context_revision(
                user_id="a",
                project_id=project_id,
                expected_context_revision=1,
                session=session,
            )
            == 2
        )
        await session.commit()
    async with sessions() as session:
        with pytest.raises(CodedException) as error:
            await advance_context_revision(
                user_id="a",
                project_id=project_id,
                expected_context_revision=1,
                session=session,
            )
        assert error.value.code == 409
        await session.rollback()
    assert (
        await client.patch(
            f"/projects/{project_id}",
            headers=auth(),
            json={"expected_context_revision": 1, "system_prompt": "stale"},
        )
    ).status_code == 409


def test_openapi_exposes_revision_guards_and_nonnullable_patch_fields():
    schema = app.openapi()
    project = schema["components"]["schemas"]["Project"]
    assert "context_revision" in project["required"]
    patch = schema["components"]["schemas"]["ProjectUpdate"]
    assert patch["required"] == ["expected_context_revision"]
    assert patch["properties"]["system_prompt"]["type"] == "string"
    assert patch["additionalProperties"] is False
    operations = schema["paths"]["/projects/{project_id}"]
    assert "409" in operations["patch"]["responses"]
    assert "409" in operations["delete"]["responses"]
    revision = next(p for p in operations["delete"]["parameters"] if p["name"] == "expected_context_revision")
    assert revision["required"] is True


@pytest.mark.asyncio
async def test_concurrent_context_writes_and_duplicate_creates_have_one_winner(project_api):
    client, _, _ = project_api
    project = await create(client)
    path = f"/projects/{project['id']}"
    responses = await asyncio.gather(
        *[
            client.patch(path, headers=auth(), json={"expected_context_revision": 1, "system_prompt": prompt})
            for prompt in ("one", "two")
        ],
    )
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json() for response in responses if response.status_code == 200)
    assert (await client.get(path, headers=auth())).json() == winner
    responses = await asyncio.gather(
        *[client.post("/projects/", headers=auth(), json={"name": "Same"}) for _ in range(2)],
    )
    assert sorted(response.status_code for response in responses) == [201, 409]


@pytest.mark.asyncio
async def test_stale_membership_transaction_rolls_back_all_changes(project_api):
    client, sessions, _ = project_api
    project = await create(client)
    project_id = uuid.UUID(project["id"])
    async with sessions() as session:
        files = [
            UserFileModel(
                storage_key=str(uuid.uuid4()),
                user_id="a",
                filename=name,
                original_name=name,
                size=1,
                mime_type="text/plain",
                kind=FileKind.TEXT,
                sha256="a" * 64,
            )
            for name in ("one.txt", "two.txt")
        ]
        session.add_all(files)
        await session.commit()
        file_ids = [file.id for file in files]
        session.add(ProjectFileModel(project_id=project_id, file_id=file_ids[0], user_id="a"))
        await advance_context_revision(user_id="a", project_id=project_id, expected_context_revision=1, session=session)
        await session.commit()
    async with sessions() as session:
        session.add(ProjectFileModel(project_id=project_id, file_id=file_ids[1], user_id="a"))
        with pytest.raises(CodedException) as error:
            await advance_context_revision(
                user_id="a",
                project_id=project_id,
                expected_context_revision=1,
                session=session,
            )
        assert error.value.code == 409
        await session.rollback()
    async with sessions() as session:
        memberships = (await session.scalars(select(ProjectFileModel))).all()
        assert [membership.file_id for membership in memberships] == [file_ids[0]]
        assert (await session.get(ProjectModel, project_id)).context_revision == 2
        assert len((await session.scalars(select(UserFileModel))).all()) == 2
