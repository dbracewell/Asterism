"""US-60.2: single-use student invites and the join-code attempt limit."""

import asyncio
import uuid

import pytest
import pytest_asyncio
from asterism.core import config
from asterism.domains.classes import service as class_service
from asterism.domains.classes.invites import INVALID_INVITE, INVITE_LIFETIME_SECONDS, hash_invite_token
from asterism.domains.classes.models import ClassInviteModel, ClassMemberModel
from asterism.domains.classes.service import JOIN_FAILURE_LIMIT, TOO_MANY_ATTEMPTS
from asterism.domains.user.models import UserModel
from sqlalchemy import select, update
from test_classes import api as _api
from test_classes import join, make_class
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
api = _api
KEY = "test-system-key"


@pytest_asyncio.fixture(autouse=True)
async def system_key(monkeypatch):
    monkeypatch.setattr(config, "system_key", KEY)
    class_service.clear_join_failures()
    yield
    class_service.clear_join_failures()


async def make_invites(client, class_id, labels=("Priya",), user="teach"):
    response = await client.post(f"/classes/{class_id}/invites", headers=auth(user), json={"labels": list(labels)})
    assert response.status_code == 201, response.text
    return response.json()["items"]


async def check(client, token, key=KEY):
    return await client.post("/class-invites/check", json={"token": token, "system_key": key})


async def redeem(client, token, user_id="new-1", name="Priya P", key=KEY):
    return await client.post(
        "/class-invites/redeem",
        json={"token": token, "user_id": user_id, "display_name": name, "system_key": key},
    )


async def test_an_invite_creates_the_user_and_joins_the_class_once(api):
    client, sessions = api
    klass = await make_class(client)
    [invite] = await make_invites(client, klass["id"])
    assert invite["label"] == "Priya" and len(invite["token"]) >= 32

    preview = await check(client, invite["token"])
    assert preview.json() == {"class_name": "Biology 101", "educator_name": "Dr Teach"}

    assert (await redeem(client, invite["token"])).status_code == 200
    async with sessions() as session:
        assert await session.get(UserModel, "new-1") is not None
        member = await session.get(ClassMemberModel, (uuid.UUID(klass["id"]), "new-1"))
        assert member is not None and member.display_name == "Priya P"
        stored = await session.scalar(select(ClassInviteModel))
        assert stored.token_hash == hash_invite_token(invite["token"]) and invite["token"] not in stored.token_hash

    again = await redeem(client, invite["token"], user_id="new-2")
    assert again.status_code == 400 and again.json()["detail"] == INVALID_INVITE
    assert (await check(client, invite["token"])).status_code == 400
    async with sessions() as session:
        assert await session.get(UserModel, "new-2") is None

    listed = (await client.get(f"/classes/{klass['id']}/invites", headers=auth("teach"))).json()["items"]
    assert listed[0]["status"] == "used" and listed[0]["redeemed_name"] == "Priya P"
    assert "token" not in listed[0]


async def test_concurrent_redemptions_admit_exactly_one_account(api):
    client, sessions = api
    klass = await make_class(client)
    [invite] = await make_invites(client, klass["id"])
    results = await asyncio.gather(*(redeem(client, invite["token"], user_id=f"race-{n}") for n in range(4)))
    assert sorted(response.status_code for response in results).count(200) == 1
    async with sessions() as session:
        users = (await session.scalars(select(UserModel.id).where(UserModel.id.like("race-%")))).all()
        assert len(users) == 1


async def test_expired_revoked_and_unknown_invites_are_refused_alike(api):
    client, sessions = api
    klass = await make_class(client)
    expired, revoked = await make_invites(client, klass["id"], labels=("A", "B"))
    async with sessions() as session:
        await session.execute(
            update(ClassInviteModel)
            .where(ClassInviteModel.id == uuid.UUID(expired["id"]))
            .values(expires_at=ClassInviteModel.expires_at - INVITE_LIFETIME_SECONDS - 1)
        )
        await session.commit()
    assert (
        await client.delete(f"/classes/{klass['id']}/invites/{revoked['id']}", headers=auth("teach"))
    ).status_code == 204

    for token in (expired["token"], revoked["token"], "not-a-real-invite"):
        for response in (await check(client, token), await redeem(client, token)):
            assert response.status_code == 400 and response.json()["detail"] == INVALID_INVITE

    statuses = {
        item["label"]: item["status"]
        for item in (await client.get(f"/classes/{klass['id']}/invites", headers=auth("teach"))).json()["items"]
    }
    assert statuses == {"A": "expired", "B": "revoked"}


async def test_used_invites_cannot_be_revoked(api):
    client, _ = api
    klass = await make_class(client)
    [invite] = await make_invites(client, klass["id"])
    await redeem(client, invite["token"])
    response = await client.delete(f"/classes/{klass['id']}/invites/{invite['id']}", headers=auth("teach"))
    assert response.status_code == 400


async def test_invites_stop_working_when_the_educator_loses_access(api):
    client, _ = api
    klass = await make_class(client)
    [invite] = await make_invites(client, klass["id"])
    assert (await client.delete("/educator-access/requests/teach", headers=auth("admin"))).status_code == 204
    assert (await redeem(client, invite["token"])).status_code == 400


async def test_server_routes_require_the_system_key(api):
    client, _ = api
    klass = await make_class(client)
    [invite] = await make_invites(client, klass["id"])
    assert (await check(client, invite["token"], key="wrong")).status_code == 401
    assert (await redeem(client, invite["token"], key="wrong")).status_code == 401
    # A user's JWT is not a substitute.
    response = await client.post(
        "/class-invites/redeem",
        headers=auth("admin"),
        json={"token": invite["token"], "user_id": "x", "display_name": "x", "system_key": ""},
    )
    assert response.status_code == 401


async def test_an_invite_cannot_attach_an_existing_account(api):
    client, sessions = api
    klass = await make_class(client)
    [invite] = await make_invites(client, klass["id"])
    assert (await redeem(client, invite["token"], user_id="s1")).status_code == 400
    async with sessions() as session:
        assert await session.get(ClassMemberModel, (uuid.UUID(klass["id"]), "s1")) is None
    # The failed attempt did not use the invite up.
    assert (await redeem(client, invite["token"], user_id="new-9")).status_code == 200


async def test_only_the_owning_educator_manages_invites(api):
    client, _ = api
    klass = await make_class(client)
    [invite] = await make_invites(client, klass["id"])
    for user, expected in (("other", 404), ("s1", 403)):
        headers = auth(user)
        assert (await client.get(f"/classes/{klass['id']}/invites", headers=headers)).status_code == expected
        assert (
            await client.post(f"/classes/{klass['id']}/invites", headers=headers, json={"labels": ["x"]})
        ).status_code == expected
        assert (
            await client.delete(f"/classes/{klass['id']}/invites/{invite['id']}", headers=headers)
        ).status_code == expected


async def test_invite_requests_are_bounded(api):
    client, _ = api
    klass = await make_class(client)
    url = f"/classes/{klass['id']}/invites"
    for labels in ([], [" "], ["x" * 81], ["x"] * 51):
        assert (await client.post(url, headers=auth("teach"), json={"labels": labels})).status_code == 422


async def test_wrong_join_codes_are_limited_per_student(api):
    client, _ = api
    klass = await make_class(client)
    for _ in range(JOIN_FAILURE_LIMIT):
        assert (await join(client, "WRONGCODE1")).status_code == 400
    blocked = await join(client, klass["join_code"])
    assert blocked.status_code == 400 and blocked.json()["detail"] == TOO_MANY_ATTEMPTS
    # Another student is unaffected.
    assert (await join(client, klass["join_code"], user="s2")).status_code == 200
