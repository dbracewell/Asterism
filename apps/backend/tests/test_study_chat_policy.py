"""US-98.1: the admin and class switches for decks and quizzes from chat (EPIC-98)."""

import pytest
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.user.models import UserModel
from sqlalchemy import update
from test_class_mode_policy import course as _course
from test_memory_policy import memory as _memory
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
course = _course
memory = _memory
POLICY = "/settings/app/study-chat"


async def availability(fixture, user="a"):
    return (await fixture["client"].get("/availability", headers=auth(user))).json()["study_chat"]


async def test_on_by_default_for_everyone(memory):
    assert (await memory["client"].get(POLICY, headers=auth("admin"))).json() == {"enabled": True, "group_ids": None}
    assert await availability(memory) == {"available": True, "reason": ""}


async def test_only_admins_read_or_change_it(memory):
    assert (await memory["client"].get(POLICY, headers=auth("a"))).status_code == 403
    assert (await memory["client"].put(POLICY, headers=auth("a"), json={"enabled": False})).status_code == 403


async def test_turned_off_or_limited_to_groups(memory):
    client = memory["client"]
    saved = await client.put(POLICY, headers=auth("admin"), json={"enabled": False})
    assert saved.json() == {"enabled": False, "group_ids": None}
    assert (await availability(memory))["available"] is False

    assert (
        await client.put(POLICY, headers=auth("admin"), json={"enabled": True, "group_ids": ["nope"]})
    ).status_code == 400
    await client.put(POLICY, headers=auth("admin"), json={"enabled": True, "group_ids": ["student"]})
    async with memory["sessions"]() as session:
        await session.execute(update(UserModel).where(UserModel.id == "a").values(group_id="student"))
        await session.execute(update(UserModel).where(UserModel.id == "b").values(group_id="educator"))
        await session.commit()
    assert (await availability(memory, "a"))["available"] is True
    assert await availability(memory, "b") == {
        "available": False,
        "reason": "Decks and quizzes from chat aren't available to your group",
    }
    # An educator outside those groups can still set a class's switch.
    course = (await client.get("/availability", headers=auth("b"))).json()["course_study_chat"]
    assert course["available"] is True


async def test_a_malformed_stored_value_reads_as_off(memory):
    async with memory["sessions"]() as session:
        await session.merge(ApplicationSettingsModel(key="study_chat", value={"enabled": "yes"}))
        await session.commit()
    assert (await availability(memory))["available"] is False


async def test_an_educator_turns_it_off_for_the_course_and_students_see_who(course):
    client = course["client"]
    policy = await client.get("/chat/mode-policy", params={"project_id": course["project"]}, headers=auth())
    assert policy.json()["study_chat_enabled"] is True

    saved = await client.put(
        f"/classes/{course['class']}/mode-policy",
        headers=auth("teach"),
        json={"allowed_modes": None, "answer_reveal": True, "study_chat_enabled": False},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["study_chat_enabled"] is False

    policy = (await client.get("/chat/mode-policy", params={"project_id": course["project"]}, headers=auth())).json()
    assert policy["study_chat_enabled"] is False
    [source] = policy["sources"]
    assert (source["set_by"], source["study_chat_enabled"]) == ("Dr Teach", False)
    # The student's own projects are unaffected.
    other = await client.get("/chat/mode-policy", params={"project_id": course["other"]}, headers=auth())
    assert other.json()["study_chat_enabled"] is True
