"""US-121.1: class lists and course insights use a fixed number of queries."""

from contextlib import contextmanager

import pytest
from sqlalchemy import event
from test_class_insights import AGAIN, GOOD, add_student, insights
from test_class_insights import api as _api
from test_class_insights import klass as _klass
from test_class_insights import project_api as _project_api
from test_classes import join, make_class
from test_projects_api import auth

pytestmark = pytest.mark.asyncio
project_api, api, klass = _project_api, _api, _klass


@contextmanager
def counted(sessions):
    statements: list[str] = []
    engine = sessions.kw["bind"].sync_engine

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", capture)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", capture)


async def test_insights_take_the_same_queries_for_six_students_or_thirty(klass):
    async def queries_for(students: int) -> tuple[int, dict]:
        for n in range(students):
            await add_student(klass, f"st{len(added)}", {"cells.txt": AGAIN, "energy.txt": GOOD})
            added.append(n)
        with counted(klass["sessions"]) as statements:
            response = await insights(klass)
        assert response.status_code == 200, response.text
        return len(statements), response.json()

    added: list[int] = []
    few, small = await queries_for(6)
    many, large = await queries_for(24)
    assert small["consenting_students"] == 6 and large["consenting_students"] == 30
    assert {topic["name"]: topic["students"] for topic in large["topics"]} == {"cells.txt": 30, "energy.txt": 30}
    assert many == few


async def test_class_lists_take_the_same_queries_for_two_classes_or_twelve(api):
    client, sessions = api

    async def queries_for(total: int) -> tuple[int, int]:
        while len(made) < total:
            created = await make_class(client, name=f"Class {len(made)}")
            made.append(created)
            assert (await join(client, created["join_code"])).status_code == 200
        with counted(sessions) as taught_statements:
            taught = await client.get("/classes", headers=auth("teach"))
        with counted(sessions) as joined_statements:
            joined = await client.get("/classes/joined", headers=auth("s1"))
        assert taught.status_code == 200 and joined.status_code == 200
        assert {item["member_count"] for item in taught.json()["items"]} == {1}
        assert {item["educator_name"] for item in joined.json()["items"]} == {"Dr Teach"}
        assert len(taught.json()["items"]) == len(joined.json()["items"]) == total
        return len(taught_statements), len(joined_statements)

    made: list[dict] = []
    few = await queries_for(2)
    many = await queries_for(12)
    assert many == few
