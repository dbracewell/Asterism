"""US-60.1: educator access, classes and membership."""

import uuid

import pytest
import pytest_asyncio
from asterism.core.exceptions import UnauthorizedException
from asterism.core.schemas import AuthedUser
from asterism.domains.classes.models import ClassMemberModel, ClassModel, EducatorModel, EducatorStatus
from asterism.domains.classes.service import JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, new_join_code, normalize_join_code
from asterism.domains.user.models import UserModel
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
ROLES = {"admin": "admin", "teach": "user", "other": "user", "s1": "user", "s2": "user"}
NAMES = {"teach": "Dr Teach", "other": "Dr Other", "s1": "Student One", "s2": "Student Two"}


@pytest_asyncio.fixture
async def api(project_api, monkeypatch):
    client, sessions, _ = project_api

    def verify_token(token):
        if token not in ROLES:
            raise UnauthorizedException()
        return AuthedUser(id=token, email=f"{token}@example.test", name=NAMES.get(token, token), role=ROLES[token])

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", verify_token)
    async with sessions() as session:
        session.add_all([UserModel(id=user, name=NAMES.get(user)) for user in ROLES])
        await session.flush()
        session.add_all([EducatorModel(user_id=user, status=EducatorStatus.APPROVED) for user in ("teach", "other")])
        await session.commit()
    return client, sessions


async def make_class(client, user="teach", name="Biology 101"):
    response = await client.post("/classes", headers=auth(user), json={"name": name, "description": "Cells"})
    assert response.status_code == 201, response.text
    return response.json()


async def join(client, code, user="s1"):
    return await client.post("/classes/join", headers=auth(user), json={"code": code})


async def test_access_is_requested_then_decided_by_an_admin(api):
    client, _ = api
    assert (await client.get("/educator-access", headers=auth("s1"))).json() == {"status": "none"}
    assert (await client.post("/classes", headers=auth("s1"), json={"name": "Mine"})).status_code == 403
    assert (await client.post("/educator-access", headers=auth("s1"))).json() == {"status": "pending"}
    assert (await client.post("/classes", headers=auth("s1"), json={"name": "Mine"})).status_code == 403
    requests = (await client.get("/educator-access/requests", headers=auth("admin"))).json()
    pending = next(item for item in requests["items"] if item["user_id"] == "s1")
    assert pending == {**pending, "status": "pending", "display_name": "Student One", "email": "s1@example.test"}
    approved = await client.post("/educator-access/requests/s1/approve", headers=auth("admin"))
    assert approved.json()["status"] == "approved"
    assert (await client.post("/classes", headers=auth("s1"), json={"name": "Mine"})).status_code == 201


async def test_requesting_again_does_not_undo_a_decision(api):
    client, _ = api
    assert (await client.post("/educator-access", headers=auth("teach"))).json() == {"status": "approved"}


async def test_only_admins_decide(api):
    client, _ = api
    await client.post("/educator-access", headers=auth("s1"))
    for user in ("s1", "teach"):
        headers = auth(user)
        assert (await client.get("/educator-access/requests", headers=headers)).status_code == 401
        assert (await client.post("/educator-access/requests/s1/approve", headers=headers)).status_code == 401
        assert (await client.delete("/educator-access/requests/s1", headers=headers)).status_code == 401
    assert (await client.get("/educator-access", headers=auth("s1"))).json() == {"status": "pending"}


async def test_the_platform_admin_role_is_not_an_educator_grant(api):
    client, _ = api
    assert (await client.post("/classes", headers=auth("admin"), json={"name": "Mine"})).status_code == 403


async def test_revoking_stops_management_at_once_and_keeps_the_class(api):
    client, _ = api
    item = await make_class(client)
    assert (await join(client, item["join_code"])).status_code == 200
    assert (await client.delete("/educator-access/requests/teach", headers=auth("admin"))).status_code == 204
    url = f"/classes/{item['id']}"
    assert (await client.get(url, headers=auth("teach"))).status_code == 403
    assert (await client.get(f"{url}/members", headers=auth("teach"))).status_code == 403
    assert (await client.delete(url, headers=auth("teach"))).status_code == 403
    assert (await client.get("/classes/joined", headers=auth("s1"))).json()["total"] == 1


async def test_deciding_on_an_unknown_request_is_404(api):
    client, _ = api
    assert (await client.post("/educator-access/requests/nobody/approve", headers=auth("admin"))).status_code == 404


async def test_class_lifecycle(api):
    client, _ = api
    item = await make_class(client)
    assert len(item["join_code"]) == JOIN_CODE_LENGTH and item["member_count"] == 0
    url = f"/classes/{item['id']}"
    updated = await client.patch(url, headers=auth("teach"), json={"name": "Biology 201", "join_enabled": False})
    assert updated.json()["name"] == "Biology 201" and updated.json()["join_enabled"] is False
    assert updated.json()["description"] == "Cells"
    assert (await client.get("/classes", headers=auth("teach"))).json()["total"] == 1
    assert (await client.delete(url, headers=auth("teach"))).status_code == 204
    assert (await client.get(url, headers=auth("teach"))).status_code == 404


async def test_class_names_are_unique_per_educator(api):
    client, _ = api
    await make_class(client)
    again = await client.post("/classes", headers=auth("teach"), json={"name": "Biology 101"})
    assert again.status_code == 409
    second = await make_class(client, name="Chemistry")
    rename = await client.patch(f"/classes/{second['id']}", headers=auth("teach"), json={"name": "Biology 101"})
    assert rename.status_code == 409
    await make_class(client, user="other")


async def test_educators_cannot_reach_each_others_classes(api):
    client, _ = api
    item = await make_class(client)
    await join(client, item["join_code"])
    url = f"/classes/{item['id']}"
    other = auth("other")
    assert (await client.get(url, headers=other)).status_code == 404
    assert (await client.patch(url, headers=other, json={"name": "Taken"})).status_code == 404
    assert (await client.delete(url, headers=other)).status_code == 404
    assert (await client.post(f"{url}/join-code", headers=other)).status_code == 404
    assert (await client.get(f"{url}/members", headers=other)).status_code == 404
    assert (await client.delete(f"{url}/members/s1", headers=other)).status_code == 404
    assert (await client.get("/classes", headers=other)).json()["total"] == 0


async def test_students_cannot_manage_or_see_rosters_and_codes(api):
    client, _ = api
    item = await make_class(client)
    await join(client, item["join_code"])
    await join(client, item["join_code"], user="s2")
    url = f"/classes/{item['id']}"
    student = auth("s1")
    assert (await client.get(url, headers=student)).status_code == 403
    assert (await client.get(f"{url}/members", headers=student)).status_code == 403
    assert (await client.delete(f"{url}/members/s2", headers=student)).status_code == 403
    assert (await client.post(f"{url}/join-code", headers=student)).status_code == 403
    joined = await client.get("/classes/joined", headers=student)
    assert joined.json()["items"] == [
        {
            "id": item["id"],
            "name": "Biology 101",
            "description": "Cells",
            "educator_name": "Dr Teach",
            "insights_consent": False,
        }
    ]
    assert item["join_code"] not in joined.text and "Student Two" not in joined.text


async def test_join_and_roster(api):
    client, _ = api
    item = await make_class(client)
    assert (await join(client, item["join_code"])).status_code == 200
    assert (await join(client, item["join_code"])).status_code == 200, "joining twice is harmless"
    await join(client, item["join_code"].lower(), user="s2")
    roster = await client.get(f"/classes/{item['id']}/members", headers=auth("teach"))
    assert [member["display_name"] for member in roster.json()["items"]] == ["Student One", "Student Two"]
    assert "@example.test" not in roster.text, "student emails are never stored"
    assert (await client.get(f"/classes/{item['id']}", headers=auth("teach"))).json()["member_count"] == 2


async def test_codes_normalize_and_are_unambiguous():
    assert normalize_join_code(" abcd-efgh ") == "ABCDEFGH"
    assert set(new_join_code()) <= set(JOIN_CODE_ALPHABET)
    assert not set("01OI") & set(JOIN_CODE_ALPHABET)
    assert len({new_join_code() for _ in range(200)}) == 200


async def test_all_refused_codes_look_the_same(api):
    client, _ = api
    disabled = await make_class(client)
    await client.patch(f"/classes/{disabled['id']}", headers=auth("teach"), json={"join_enabled": False})
    removed = await make_class(client, name="Removed from")
    await join(client, removed["join_code"])
    await client.delete(f"/classes/{removed['id']}/members/s1", headers=auth("teach"))
    responses = [
        await join(client, "NOTAREALCODE"),
        await join(client, disabled["join_code"]),
        await join(client, removed["join_code"]),
    ]
    assert {response.status_code for response in responses} == {400}
    assert len({response.text for response in responses}) == 1


async def test_rotating_stops_the_old_code_and_keeps_members(api):
    client, _ = api
    item = await make_class(client)
    await join(client, item["join_code"])
    rotated = (await client.post(f"/classes/{item['id']}/join-code", headers=auth("teach"))).json()
    assert rotated["join_code"] != item["join_code"] and rotated["member_count"] == 1
    assert (await join(client, item["join_code"], user="s2")).status_code == 400
    assert (await join(client, rotated["join_code"], user="s2")).status_code == 200


async def test_educator_cannot_join_their_own_class(api):
    client, _ = api
    item = await make_class(client)
    response = await join(client, item["join_code"], user="teach")
    assert response.status_code == 400 and "run this class" in response.text


async def test_removed_students_lose_the_class_and_need_allowing_back(api):
    client, _ = api
    item = await make_class(client)
    await join(client, item["join_code"])
    member = f"/classes/{item['id']}/members/s1"
    assert (await client.delete(member, headers=auth("teach"))).status_code == 204
    assert (await client.get("/classes/joined", headers=auth("s1"))).json()["total"] == 0
    assert (await client.get(f"/classes/{item['id']}", headers=auth("teach"))).json()["member_count"] == 0
    assert (await join(client, item["join_code"])).status_code == 400
    assert (await client.delete(f"{member}/removal", headers=auth("teach"))).status_code == 204
    assert (await client.get("/classes/joined", headers=auth("s1"))).json()["total"] == 0, "not re-added"
    assert (await join(client, item["join_code"])).status_code == 200


async def test_allowing_back_needs_a_removal(api):
    client, _ = api
    item = await make_class(client)
    await join(client, item["join_code"])
    member = f"/classes/{item['id']}/members/s1"
    assert (await client.delete(f"{member}/removal", headers=auth("teach"))).status_code == 400
    assert (await client.delete(f"/classes/{item['id']}/members/s2", headers=auth("teach"))).status_code == 404


async def test_leaving_cannot_erase_a_removal(api):
    client, _ = api
    item = await make_class(client)
    await join(client, item["join_code"])
    await client.delete(f"/classes/{item['id']}/members/s1", headers=auth("teach"))
    assert (await client.delete(f"/classes/joined/{item['id']}", headers=auth("s1"))).status_code == 404
    assert (await join(client, item["join_code"])).status_code == 400


async def test_leaving_a_class(api):
    client, _ = api
    item = await make_class(client)
    await join(client, item["join_code"])
    assert (await client.delete(f"/classes/joined/{item['id']}", headers=auth("s1"))).status_code == 204
    assert (await client.get("/classes/joined", headers=auth("s1"))).json()["total"] == 0
    assert (await client.delete(f"/classes/joined/{item['id']}", headers=auth("s1"))).status_code == 404
    assert (await join(client, item["join_code"])).status_code == 200


async def test_routes_need_authentication(api):
    client, _ = api
    class_id = uuid.uuid4()
    for method, url in [
        ("GET", "/educator-access"),
        ("GET", "/classes"),
        ("GET", "/classes/joined"),
        ("GET", f"/classes/{class_id}"),
        ("POST", "/classes/join"),
    ]:
        assert (await client.request(method, url)).status_code == 401


async def test_database_refuses_duplicate_and_orphan_members(api):
    client, sessions = api
    item = await make_class(client)
    class_id = uuid.UUID(item["id"])
    await join(client, item["join_code"])
    async with sessions() as session:
        session.add(ClassMemberModel(class_id=class_id, user_id="s1"))
        with pytest.raises(IntegrityError):
            await session.flush()
        await session.rollback()
        session.add(ClassMemberModel(class_id=uuid.uuid4(), user_id="s2"))
        with pytest.raises(IntegrityError):
            await session.flush()
        await session.rollback()
        session.add(ClassMemberModel(class_id=class_id, user_id="ghost"))
        with pytest.raises(IntegrityError):
            await session.flush()


async def test_database_refuses_a_second_class_with_the_same_code(api):
    client, sessions = api
    item = await make_class(client)
    async with sessions() as session:
        session.add(ClassModel(educator_id="other", name="Clash", join_code=item["join_code"]))
        with pytest.raises(IntegrityError):
            await session.flush()


async def test_deleting_a_class_or_user_removes_their_membership_rows(api):
    client, sessions = api
    item = await make_class(client)
    gone = await make_class(client, name="Gone")
    await join(client, item["join_code"])
    await join(client, gone["join_code"])
    await join(client, item["join_code"], user="s2")
    await client.delete(f"/classes/{gone['id']}", headers=auth("teach"))
    async with sessions() as session:
        count = select(func.count()).select_from(ClassMemberModel)
        assert await session.scalar(count) == 2
        await session.execute(delete(UserModel).where(UserModel.id == "s2"))
        await session.commit()
        assert await session.scalar(count) == 1
        await session.execute(delete(UserModel).where(UserModel.id == "teach"))
        await session.commit()
        assert await session.scalar(count) == 0
        assert await session.scalar(select(func.count()).select_from(ClassModel)) == 0
