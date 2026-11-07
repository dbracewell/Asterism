"""US-64.3: the administrator's user list is read-only, searchable and paged."""

import pytest
from asterism.domains.classes.models import EducatorModel, EducatorStatus
from asterism.domains.user.models import UserModel
from sqlalchemy import update
from test_user_lifecycle import auth, user_api_db
from test_user_lifecycle import user_api as _user_api

pytestmark = pytest.mark.asyncio
user_api = _user_api
sessions = user_api_db


async def seed(client, db):
    """Admin-created accounts with known names; ``nobody`` has no name yet."""
    for user_id, name, email in (
        ("u-zed", "Zed Quill", "zed@example.test"),
        ("u-amy", "amy Pond", "amy@school.test"),
        ("u-50%", "Fifty_Percent", "pct@example.test"),
    ):
        body = {"user_id": user_id, "name": name, "email": email}
        assert (await client.post("/users/", json=body, headers=auth("admin"))).status_code == 200
    assert (await client.post("/users/", json={"user_id": "nobody"}, headers=auth("admin"))).status_code == 200
    async with db() as session:
        session.add(EducatorModel(user_id="u-amy", status=EducatorStatus.APPROVED))
        session.add(EducatorModel(user_id="u-zed", status=EducatorStatus.PENDING))
        await session.execute(update(UserModel).where(UserModel.id == "u-zed").values(created_at=1_700_000_000))
        await session.commit()


async def listing(client, **params):
    response = await client.get("/users/", headers=auth("admin"), params=params)
    assert response.status_code == 200, response.text
    return response.json()


async def test_only_administrators_see_the_list(user_api):
    client, _, _ = user_api
    assert (await client.get("/users/")).status_code == 401
    assert (await client.get("/users/", headers=auth("a"))).status_code == 401


async def test_lists_names_emails_educator_status_and_created_date(user_api, sessions):
    client, _, _ = user_api
    await seed(client, sessions)
    page = await listing(client)
    # Sorted by name ignoring case, unnamed accounts last. "admin" was provisioned by its own requests.
    assert [item["id"] for item in page["items"]] == ["admin", "u-amy", "u-50%", "u-zed", "nobody"]
    assert page["total"] == 5
    by_id = {item["id"]: item for item in page["items"]}
    assert by_id["u-amy"] | {"created_at": 0} == {
        "id": "u-amy",
        "name": "amy Pond",
        "email": "amy@school.test",
        "educator": "approved",
        "created_at": 0,
    }
    assert by_id["u-zed"]["educator"] == "pending" and by_id["u-zed"]["created_at"] == 1_700_000_000
    assert by_id["nobody"] == by_id["nobody"] | {"name": None, "email": None, "educator": None}
    assert by_id["admin"]["created_at"] > 1_700_000_000


async def test_search_matches_name_email_or_id_case_insensitively(user_api, sessions):
    client, _, _ = user_api
    await seed(client, sessions)

    async def ids(search):
        return [item["id"] for item in (await listing(client, search=search))["items"]]

    assert await ids("amy") == ["u-amy"]
    assert await ids("SCHOOL.test") == ["u-amy"]
    assert await ids("nobo") == ["nobody"]
    # Wildcards are literal text.
    assert await ids("%") == ["u-50%"]
    assert await ids("_") == ["u-50%"]
    assert await ids("  ") == ["admin", "u-amy", "u-50%", "u-zed", "nobody"]
    assert (await listing(client, search="no-such-person"))["total"] == 0


async def test_pages_are_stable(user_api, sessions):
    client, _, _ = user_api
    await seed(client, sessions)
    first = await listing(client, page=1, page_size=2)
    second = await listing(client, page=2, page_size=2)
    third = await listing(client, page=3, page_size=2)
    assert (first["total"], first["page"], first["page_size"]) == (5, 1, 2)
    pages = [item["id"] for page in (first, second, third) for item in page["items"]]
    assert pages == ["admin", "u-amy", "u-50%", "u-zed", "nobody"]
    bad = await client.get("/users/", headers=auth("admin"), params={"page_size": 101})
    assert bad.status_code == 422
