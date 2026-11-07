"""US-64.2: classes and educator access show live names, not snapshots.

Each test renames someone in their token. Their next request syncs the stored
copy (US-64.1); every reader then shows the new name without anyone else
doing anything.
"""

import uuid

import pytest
import pytest_asyncio
import test_classes
from asterism.core import config
from asterism.domains.classes import educators
from asterism.domains.classes import service as class_service
from asterism.domains.classes.names import EDUCATOR_FALLBACK, STUDENT_FALLBACK, USER_FALLBACK, educator_name
from asterism.domains.user.models import UserModel
from asterism.domains.user.service import clear_user_cache
from sqlalchemy import update
from test_class_invites import KEY, check, make_invites, redeem
from test_classes import api as _api
from test_classes import join, make_class
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
api = _api


@pytest_asyncio.fixture(autouse=True)
async def system_key(monkeypatch):
    monkeypatch.setattr(config, "system_key", KEY)


async def rename(client, monkeypatch, user, name):
    """Change the name in the user's token; any request of theirs syncs it."""
    monkeypatch.setitem(test_classes.NAMES, user, name)
    assert (await client.get("/educator-access", headers=auth(user))).status_code == 200


async def test_admin_sees_the_requesters_current_name_and_email(api, monkeypatch):
    client, _ = api
    await client.post("/educator-access", headers=auth("s1"))
    await rename(client, monkeypatch, "s1", "Sam One")

    requests = (await client.get("/educator-access/requests", headers=auth("admin"))).json()["items"]
    pending = next(item for item in requests if item["user_id"] == "s1")
    assert (pending["display_name"], pending["email"]) == ("Sam One", "s1@example.test")
    approved = (await client.post("/educator-access/requests/s1/approve", headers=auth("admin"))).json()
    assert approved["display_name"] == "Sam One"


async def test_students_see_the_educators_current_name(api, monkeypatch):
    client, _ = api
    klass = await make_class(client)
    assert (await join(client, klass["join_code"])).json()["educator_name"] == "Dr Teach"
    [invite] = await make_invites(client, klass["id"])

    await rename(client, monkeypatch, "teach", "Prof Teach")

    joined = (await client.get("/classes/joined", headers=auth("s1"))).json()["items"]
    assert [item["educator_name"] for item in joined] == ["Prof Teach"]
    consent = await client.put(
        f"/classes/joined/{klass['id']}/insights-consent", headers=auth("s1"), json={"consent": True}
    )
    assert consent.json()["educator_name"] == "Prof Teach"
    assert (await check(client, invite["token"])).json()["educator_name"] == "Prof Teach"
    assert (await redeem(client, invite["token"])).json()["educator_name"] == "Prof Teach"


async def test_the_roster_shows_and_sorts_by_current_names(api, monkeypatch):
    client, _ = api
    klass = await make_class(client)
    for student in ("s1", "s2"):
        await join(client, klass["join_code"], user=student)

    await rename(client, monkeypatch, "s1", "Zoe One")

    roster = (await client.get(f"/classes/{klass['id']}/members", headers=auth("teach"))).json()["items"]
    assert [member["display_name"] for member in roster] == ["Student Two", "Zoe One"]


async def test_a_used_invite_shows_the_current_name_until_the_account_is_gone(api, monkeypatch):
    client, sessions = api
    klass = await make_class(client)
    [invite] = await make_invites(client, klass["id"])
    assert (await redeem(client, invite["token"], user_id="new-1", name="Priya P")).status_code == 200

    async def used_by():
        listed = await client.get(f"/classes/{klass['id']}/invites", headers=auth("teach"))
        return listed.json()["items"][0]["redeemed_name"]

    assert await used_by() == "Priya P"
    monkeypatch.setitem(test_classes.ROLES, "new-1", "user")
    await rename(client, monkeypatch, "new-1", "Priya Patel")
    assert await used_by() == "Priya Patel"

    # The account is deleted: the invite keeps the name it was used with.
    async with sessions() as session:
        await session.delete(await session.get(UserModel, "new-1"))
        await session.commit()
    clear_user_cache()
    assert await used_by() == "Priya P"


async def test_missing_names_show_a_neutral_fallback(api):
    """Every request resyncs from the token, so read through the services directly."""
    client, sessions = api
    klass = await make_class(client)
    await join(client, klass["join_code"])
    await client.post("/educator-access", headers=auth("s2"))
    async with sessions() as session:
        await session.execute(update(UserModel).values(name=None, email=None))
        await session.commit()

        assert await educator_name("teach", session) == EDUCATOR_FALLBACK
        roster = await class_service.list_members("teach", uuid.UUID(klass["id"]), session, page=1, page_size=10)
        assert [member.display_name for member in roster.items] == [STUDENT_FALLBACK]
        requests = await educators.list_requests(session, page=1, page_size=10)
        pending = next(item for item in requests.items if item.user_id == "s2")
        assert (pending.display_name, pending.email) == (USER_FALLBACK, None)
