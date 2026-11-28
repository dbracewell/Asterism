"""US-121.2: the usage report is paged and filtered in the database, and budgets are read once."""

import uuid
from contextlib import contextmanager

import pytest
import pytest_asyncio
from asterism.domains.groups.models import GroupModel
from asterism.domains.usage.models import UsageRecordModel
from asterism.domains.usage.service import require_within_budget
from asterism.domains.user.models import UserModel
from sqlalchemy import event, insert, update
from test_projects_api import auth
from test_usage import set_budget
from test_usage import usage_api as _usage_api

pytest_plugins = ["test_projects_api"]
pytestmark = pytest.mark.asyncio
usage_api = _usage_api

PEOPLE = 1500
MODELS = (uuid.UUID(int=1), uuid.UUID(int=2))


@contextmanager
def counted(sessions):
    statements: list[tuple[str, object]] = []
    engine = sessions.kw["bind"].sync_engine

    def capture(_connection, _cursor, statement, parameters, _context, _many):
        statements.append((statement, parameters))

    event.listen(engine, "before_cursor_execute", capture)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", capture)


@pytest_asyncio.fixture
async def crowd(usage_api, monkeypatch):
    """1,500 users, alternating between a custom group and student, each with two models' usage."""
    client, sessions, _ = usage_api
    monkeypatch.setattr(
        "asterism.core.security.verify_jwks_token",
        lambda token: __import__("asterism.core.schemas", fromlist=["AuthedUser"]).AuthedUser(
            id=token, email=f"{token}@example.test", name=token, role="admin"
        ),
    )
    async with sessions() as session:
        session.add(GroupModel(id="g7", name="Year 7"))
        await session.flush()
        await session.execute(
            insert(UserModel),
            [
                {"id": f"u{n:04}", "name": f"Person {n:04}", "email": f"p{n}@school.test", "group_id": group}
                for n in range(PEOPLE)
                for group in ["g7" if n % 2 else "student"]
            ],
        )
        await session.execute(
            insert(UsageRecordModel),
            [
                {
                    "id": uuid.uuid4(),
                    "user_id": f"u{n:04}",
                    "source": "chat",
                    "model_id": model,
                    "model_name": f"Model {index}",
                    "input_tokens": n + 1,
                    "output_tokens": index,
                    "input_price_per_million": 1.0 if index == 0 else None,
                    "output_price_per_million": 1.0 if index == 0 else None,
                }
                for n in range(PEOPLE)
                for index, model in enumerate(MODELS)
            ],
        )
        await session.commit()
    return client, sessions


async def report(client, **query):
    response = await client.get("/usage/report", headers=auth("root"), params=query)
    assert response.status_code == 200, response.text
    return response.json()


async def test_the_report_returns_one_page_with_totals_for_everyone(crowd):
    client, sessions = crowd
    with counted(sessions) as statements:
        body = await report(client, page=2, page_size=100)
    usage_queries = [(sql, params) for sql, params in statements if "usage_records" in sql]
    # Groups, the user count, the page, and the page's models: four, however many users.
    assert len(usage_queries) == 4, [sql for sql, _ in usage_queries]
    [named] = [params for sql, params in usage_queries if " IN (" in sql]
    assert len([value for value in named if str(value).startswith("u")]) == 100, "one page of users, no more"

    assert (body["page"], body["page_size"], body["total_users"]) == (2, 100, PEOPLE)
    assert len(body["users"]) == 100
    # Most tokens first: page 2 starts at the 101st heaviest user.
    first = body["users"][0]
    assert first["user_id"] == f"u{PEOPLE - 101:04}" and first["name"] == f"Person {PEOPLE - 101:04}"
    assert [model["model_name"] for model in first["models"]] == ["Model 0", "Model 1"]
    assert first["total_tokens"] == 2 * (PEOPLE - 100) + 1
    assert first["cost_usd"] == pytest.approx((PEOPLE - 100) / 1_000_000)

    everyone = sum(2 * (n + 1) + 1 for n in range(PEOPLE))
    assert body["total_tokens"] == everyone
    assert body["cost_usd"] == pytest.approx(sum(n + 1 for n in range(PEOPLE)) / 1_000_000)
    groups = {group["group_id"]: group for group in body["groups"]}
    assert {key: groups[key]["users"] for key in groups} == {"g7": PEOPLE // 2, "student": PEOPLE // 2}
    assert groups["g7"]["group_name"] == "Year 7"
    assert sum(group["total_tokens"] for group in body["groups"]) == everyone

    last = await report(client, page=PEOPLE // 100, page_size=100)
    assert last["users"][-1]["user_id"] == "u0000"
    assert (await report(client, page=PEOPLE // 100 + 1, page_size=100))["users"] == []
    assert (await client.get("/usage/report?page_size=101", headers=auth("root"))).status_code == 422


async def test_group_and_search_filters_narrow_users_but_not_totals(crowd):
    client, _ = crowd
    year7 = await report(client, group_id="g7", page_size=10)
    assert year7["total_users"] == PEOPLE // 2
    assert {row["group_id"] for row in year7["users"]} == {"g7"}
    assert year7["total_tokens"] == (await report(client))["total_tokens"]

    found = await report(client, search="person 012")
    assert sorted(row["user_id"] for row in found["users"]) == [f"u{n:04}" for n in range(120, 130)]
    assert found["total_users"] == 10
    by_email = await report(client, search="p1499@", group_id="g7")
    assert [row["user_id"] for row in by_email["users"]] == ["u1499"]
    assert (await report(client, search="%"))["total_users"] == 0, "wildcards are matched literally"


async def test_a_budget_check_reads_the_group_budget_once(usage_api):
    _, sessions, _ = usage_api
    await set_budget(sessions, "student", daily=1000)
    async with sessions() as session:
        await session.execute(update(UserModel).where(UserModel.id == "a").values(group_id="student"))
        await session.commit()
        with counted(sessions) as statements:
            await require_within_budget("a", session)
    assert sum("daily_token_budget" in sql for sql, _ in statements) == 1
    assert sum("app_settings" in sql for sql, _ in statements) == 1
