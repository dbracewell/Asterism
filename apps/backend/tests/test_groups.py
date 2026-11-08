"""US-70.1: every user is in one group; built-ins, admin mirroring and educator moves (ADR-0058)."""

import pytest
from asterism.core import config
from asterism.domains.groups.models import GroupModel
from asterism.domains.user.models import UserModel
from sqlalchemy import select
from test_classes import ROLES
from test_classes import api as _api
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
api = _api
project_api = _project_api


async def group_of(sessions, user_id):
    async with sessions() as session:
        return await session.scalar(select(UserModel.group_id).where(UserModel.id == user_id))


async def groups(client, user="admin"):
    response = await client.get("/groups", headers=auth(user))
    assert response.status_code == 200, response.text
    return {item["id"]: item for item in response.json()}


async def test_built_in_groups_exist_and_new_users_join_student(api):
    client, sessions = api
    listed = await groups(client)
    assert [(item["id"], item["name"], item["built_in"]) for item in listed.values()] == [
        ("admin", "Admin", True),
        ("educator", "Educator", True),
        ("student", "Student", True),
    ]
    assert (await client.post("/users/", json={"user_id": "fresh"}, headers=auth("admin"))).status_code == 200
    assert await group_of(sessions, "fresh") == "student"


async def test_the_admin_group_mirrors_the_token_role(api, monkeypatch):
    client, sessions = api
    await client.get("/groups", headers=auth("admin"))
    assert await group_of(sessions, "admin") == "admin"
    assert (await groups(client))["admin"]["member_count"] == 1

    # The role is taken away in sign-in: the next request drops them to Student.
    monkeypatch.setitem(ROLES, "admin", "user")
    assert (await client.get("/groups", headers=auth("admin"))).status_code == 401
    assert await group_of(sessions, "admin") == "student"

    # And a user given the role joins Admin, whatever group they were in.
    monkeypatch.setitem(ROLES, "teach", "admin")
    assert (await client.get("/groups", headers=auth("teach"))).status_code == 200
    assert await group_of(sessions, "teach") == "admin"


async def test_only_administrators_manage_groups(api):
    client, _ = api
    assert (await client.get("/groups", headers=auth("s1"))).status_code == 401
    assert (await client.post("/groups", headers=auth("teach"), json={"name": "Night"})).status_code == 401
    assert (
        await client.put("/groups/members/s1", headers=auth("teach"), json={"group_id": "educator"})
    ).status_code == 401
    assert await group_of(api[1], "s1") == "student"


async def test_educator_requests_move_users_between_educator_and_student(api):
    client, sessions = api
    assert (await client.post("/educator-access", headers=auth("s1"))).json() == {"status": "pending"}
    assert await group_of(sessions, "s1") == "student"
    pending = (await client.get("/educator-access/requests", headers=auth("admin"))).json()
    assert pending["items"][0] | {"created_at": 0} == {
        "user_id": "s1",
        "status": "pending",
        "display_name": "Student One",
        "email": "s1@example.test",
        "created_at": 0,
    }
    assert pending["total"] == 3  # s1 pending, then teach and other already educators

    approved = await client.post("/educator-access/requests/s1/approve", headers=auth("admin"))
    assert approved.status_code == 200 and approved.json()["status"] == "approved"
    assert await group_of(sessions, "s1") == "educator"
    assert (await client.get("/educator-access", headers=auth("s1"))).json() == {"status": "approved"}
    assert (await client.post("/classes", headers=auth("s1"), json={"name": "Night school"})).status_code == 201

    assert (await client.delete("/educator-access/requests/s1", headers=auth("admin"))).status_code == 204
    assert await group_of(sessions, "s1") == "student"
    assert (await client.get("/educator-access", headers=auth("s1"))).json() == {"status": "none"}
    assert (await client.get("/classes", headers=auth("s1"))).status_code == 403


async def test_denying_keeps_the_user_in_their_group(api):
    client, sessions = api
    await client.post("/educator-access", headers=auth("s2"))
    assert (await client.delete("/educator-access/requests/s2", headers=auth("admin"))).status_code == 204
    assert await group_of(sessions, "s2") == "student"
    assert (await client.get("/educator-access", headers=auth("s2"))).json() == {"status": "none"}
    assert (await client.delete("/educator-access/requests/s2", headers=auth("admin"))).status_code == 404


async def test_moving_into_educator_resolves_a_pending_request(api):
    client, sessions = api
    await client.post("/educator-access", headers=auth("s1"))
    moved = await client.put("/groups/members/s1", headers=auth("admin"), json={"group_id": "educator"})
    assert moved.status_code == 200 and moved.json() == {"id": "educator", "name": "Educator"}
    # Moving out again revokes, and no stale request comes back as pending.
    await client.put("/groups/members/s1", headers=auth("admin"), json={"group_id": "student"})
    assert (await client.get("/educator-access", headers=auth("s1"))).json() == {"status": "none"}


async def test_custom_groups_can_be_created_renamed_and_deleted_when_empty(api):
    client, sessions = api
    created = await client.post("/groups", headers=auth("admin"), json={"name": "  Night school  "})
    assert created.status_code == 201, created.text
    group = created.json()
    assert group | {"id": ""} == {"id": "", "name": "Night school", "built_in": False, "member_count": 0}
    duplicate = await client.post("/groups", headers=auth("admin"), json={"name": "night SCHOOL"})
    assert duplicate.status_code == 409
    assert (await client.post("/groups", headers=auth("admin"), json={"name": "   "})).status_code == 422

    url = f"/groups/{group['id']}"
    renamed = await client.patch(url, headers=auth("admin"), json={"name": "Evening"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Evening"

    assert (
        await client.put("/groups/members/s1", headers=auth("admin"), json={"group_id": group["id"]})
    ).status_code == 200
    assert (await groups(client))[group["id"]]["member_count"] == 1
    refused = await client.delete(url, headers=auth("admin"))
    assert refused.status_code == 409 and "1 member" in refused.json()["detail"]

    await client.put("/groups/members/s1", headers=auth("admin"), json={"group_id": "student"})
    assert (await client.delete(url, headers=auth("admin"))).status_code == 204
    async with sessions() as session:
        assert await session.get(GroupModel, group["id"]) is None


@pytest.mark.parametrize("group_id", ["admin", "educator", "student"])
async def test_built_in_groups_cannot_be_renamed_or_deleted(api, group_id):
    client, _ = api
    url = f"/groups/{group_id}"
    assert (await client.patch(url, headers=auth("admin"), json={"name": "Other"})).status_code == 409
    assert (await client.delete(url, headers=auth("admin"))).status_code == 409
    assert (await groups(client))[group_id]["name"] == group_id.title()


async def test_the_admin_group_is_never_set_by_membership(api):
    client, sessions = api
    await client.get("/groups", headers=auth("admin"))
    into = await client.put("/groups/members/s1", headers=auth("admin"), json={"group_id": "admin"})
    out_of = await client.put("/groups/members/admin", headers=auth("admin"), json={"group_id": "student"})
    assert into.status_code == out_of.status_code == 409
    assert (await group_of(sessions, "s1"), await group_of(sessions, "admin")) == ("student", "admin")
    missing_user = await client.put("/groups/members/nobody", headers=auth("admin"), json={"group_id": "student"})
    missing_group = await client.put("/groups/members/s1", headers=auth("admin"), json={"group_id": "nope"})
    assert missing_user.status_code == missing_group.status_code == 404


async def test_revoked_educators_invites_stop_working(api):
    client, sessions = api
    item = (await client.post("/classes", headers=auth("teach"), json={"name": "Physics"})).json()
    created = await client.post(f"/classes/{item['id']}/invites", headers=auth("teach"), json={"labels": ["Ana"]})
    assert created.status_code in (200, 201), created.text
    body = {"token": created.json()["items"][0]["token"], "system_key": config.system_key}
    assert (await client.post("/class-invites/check", json=body)).status_code == 200
    await client.delete("/educator-access/requests/teach", headers=auth("admin"))
    assert (await client.post("/class-invites/check", json=body)).status_code == 400
