"""Fresh-schema persona invariants and owner-scoped lifecycle races."""

import asyncio
import uuid
from unittest.mock import AsyncMock

import pytest
from asterism.domains.user.models import PersonaProfileModel, UserModel
from asterism.domains.user.service import create_user
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from test_user_lifecycle import auth
from test_user_lifecycle import user_api as _user_api
from test_user_lifecycle import user_service_env as _user_service_env

user_api = _user_api
user_service_env = _user_service_env


@pytest.mark.asyncio
async def test_provisioning_creates_one_owned_default_even_for_direct_sql(user_service_env):
    sessions, _, _ = user_service_env
    async with sessions() as db:
        await create_user("a", db)
        await create_user("a", db)
        await db.execute(insert(UserModel).values(id="b"))
        await db.commit()
        users = (await db.scalars(select(UserModel))).all()
        profiles = (await db.scalars(select(PersonaProfileModel))).all()
        assert len(users) == len(profiles) == 2
        assert all(any(p.id == u.default_persona_id and p.user_id == u.id for p in profiles) for u in users)


@pytest.mark.asyncio
async def test_main_configuration_failure_rolls_back_initial_persona(user_service_env, monkeypatch):
    sessions, _, _ = user_service_env
    monkeypatch.setattr(
        "asterism.domains.user.service.provision_main_agent", AsyncMock(side_effect=RuntimeError("fail"))
    )
    async with sessions() as db:
        with pytest.raises(RuntimeError):
            await create_user("a", db)
        await db.rollback()
        assert await db.scalar(select(func.count()).select_from(UserModel)) == 0
        assert await db.scalar(select(func.count()).select_from(PersonaProfileModel)) == 0


@pytest.mark.asyncio
async def test_direct_sql_cannot_drop_last_default_or_select_foreign_profile(user_service_env):
    sessions, _, _ = user_service_env
    async with sessions() as db:
        await create_user("a", db)
        await create_user("b", db)
        a = await db.get(UserModel, "a")
        b = await db.get(UserModel, "b")
        default_a, default_b = a.default_persona_id, b.default_persona_id
    for statement in (
        delete(PersonaProfileModel).where(PersonaProfileModel.id == default_a),
        update(UserModel).where(UserModel.id == "a").values(default_persona_id=default_b),
        update(UserModel).where(UserModel.id == "a").values(default_persona_id=None),
    ):
        async with sessions() as db:
            with pytest.raises(IntegrityError):
                await db.execute(statement)
                await db.commit()
            await db.rollback()
    async with sessions() as db:
        await db.execute(delete(UserModel).where(UserModel.id == "a"))
        await db.commit()
        assert (await db.scalars(select(PersonaProfileModel.user_id))).all() == ["b"]


@pytest.mark.asyncio
async def test_persona_api_auth_ownership_defaults_and_conflicts(user_api):
    client, _, _ = user_api
    assert (await client.get("/users/personas")).status_code == 401
    initial = (await client.get("/users/personas", headers=auth("a"))).json()
    assert len(initial["profiles"]) == 1 and initial["profiles"][0]["is_default"]
    created = await client.post(
        "/users/personas", headers=auth("a"), json={"name": "Teaching", "user_md": "# Preferences\nUse examples."}
    )
    assert created.status_code == 200, created.text
    persona = created.json()
    path = f"/users/personas/{persona['id']}"
    for identity in (persona["id"], str(uuid.uuid4())):
        assert (await client.get(f"/users/personas/{identity}", headers=auth("b"))).status_code == 404
        assert (
            await client.patch(
                f"/users/personas/{identity}",
                headers=auth("b"),
                json={"name": "No", "user_md": "", "expected_revision": 1},
            )
        ).status_code == 404
        assert (
            await client.delete(f"/users/personas/{identity}?expected_revision=1", headers=auth("b"))
        ).status_code == 404
        assert (
            await client.put(
                "/users/personas/default",
                headers=auth("b"),
                json={"persona_id": identity, "expected_default_revision": 1},
            )
        ).status_code == 404
    changed = await client.patch(
        path, headers=auth("a"), json={"name": "Teaching", "user_md": "Revised", "expected_revision": 1}
    )
    assert changed.status_code == 200 and changed.json()["revision"] == 2
    assert (
        await client.patch(path, headers=auth("a"), json={"name": "Lost edit", "user_md": "", "expected_revision": 1})
    ).status_code == 409
    assert (await client.delete(path + "?expected_revision=1", headers=auth("a"))).status_code == 409
    response = await client.put(
        "/users/personas/default", headers=auth("a"), json={"persona_id": persona["id"], "expected_default_revision": 1}
    )
    assert response.status_code == 200, response.text
    assert response.json()["default_revision"] == 2
    assert len([p for p in response.json()["profiles"] if p["is_default"]]) == 1
    assert (await client.delete(path + "?expected_revision=2", headers=auth("a"))).status_code == 409
    old = initial["default_persona_id"]
    assert (await client.delete(f"/users/personas/{old}?expected_revision=1", headers=auth("a"))).status_code == 200


@pytest.mark.asyncio
async def test_concurrent_default_switches_and_edits_preserve_one_winner(user_api):
    client, _, _ = user_api
    p = [
        (await client.post("/users/personas", headers=auth("a"), json={"name": name})).json() for name in ("One", "Two")
    ]
    switches = await asyncio.gather(
        *[
            client.put(
                "/users/personas/default",
                headers=auth("a"),
                json={"persona_id": row["id"], "expected_default_revision": 1},
            )
            for row in p
        ]
    )
    assert sorted(r.status_code for r in switches) == [200, 409]
    edits = await asyncio.gather(
        *[
            client.patch(
                f"/users/personas/{p[0]['id']}",
                headers=auth("a"),
                json={"name": name, "user_md": name, "expected_revision": 1},
            )
            for name in ("First edit", "Second edit")
        ]
    )
    assert sorted(r.status_code for r in edits) == [200, 409]
    current = (await client.get("/users/personas", headers=auth("a"))).json()
    assert sum(p["is_default"] for p in current["profiles"]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"name": " "},
        {"name": "x" * 81},
        {"name": "Null\x00"},
        {"name": "Good", "user_md": "x" * 16001},
        {"name": "Good", "user_md": "\x00"},
        {"name": "Good", "user_md": "\x01"},
        {"name": "Good", "owner_id": "b"},
    ],
)
async def test_persona_text_validation(user_api, payload):
    client, _, _ = user_api
    assert (await client.post("/users/personas", headers=auth("a"), json=payload)).status_code == 422


@pytest.mark.asyncio
async def test_persona_collection_limit_is_owner_scoped_and_database_enforced(user_api):
    client, _, _ = user_api
    for n in range(19):
        response = await client.post("/users/personas", headers=auth("a"), json={"name": f"Persona {n}"})
        assert response.status_code == 200, response.text
    assert (await client.post("/users/personas", headers=auth("a"), json={"name": "Extra"})).status_code == 409
    assert len((await client.get("/users/personas", headers=auth("a"))).json()["profiles"]) == 20
    assert len((await client.get("/users/personas", headers=auth("b"))).json()["profiles"]) == 1


@pytest.mark.asyncio
async def test_default_switch_and_delete_race_never_leave_a_dangling_default(user_api):
    client, _, _ = user_api
    created = (await client.post("/users/personas", headers=auth("a"), json={"name": "Candidate"})).json()
    results = await asyncio.gather(
        client.put(
            "/users/personas/default",
            headers=auth("a"),
            json={"persona_id": created["id"], "expected_default_revision": 1},
        ),
        client.delete(f"/users/personas/{created['id']}?expected_revision=1", headers=auth("a")),
    )
    assert [r.status_code for r in results] in ([200, 409], [404, 200])
    current = (await client.get("/users/personas", headers=auth("a"))).json()
    assert sum(p["is_default"] for p in current["profiles"]) == 1
    assert any(p["id"] == current["default_persona_id"] for p in current["profiles"])


@pytest.mark.asyncio
async def test_raw_sql_bootstrap_and_profile_ownership_cannot_be_reassigned(user_service_env):
    from sqlalchemy import text

    sessions, _, _ = user_service_env
    async with sessions() as db:
        await db.execute(text("INSERT INTO users(id) VALUES('raw')"))
        await db.execute(text("INSERT INTO users(id) VALUES('other')"))
        await db.commit()
        raw = await db.get(UserModel, "raw")
        default_id = raw.default_persona_id
        assert await db.get(PersonaProfileModel, default_id) is not None
        with pytest.raises(IntegrityError):
            await db.execute(
                update(PersonaProfileModel).where(PersonaProfileModel.id == default_id).values(user_id="other")
            )
            await db.commit()
        await db.rollback()
