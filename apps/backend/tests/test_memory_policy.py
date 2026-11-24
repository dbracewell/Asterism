"""US-93.2: the memory switches (ADR-0078): admin policy and groups, the person's
setting, and the course. Each is read live, and the first one that is off is named."""

import uuid

import pytest
import pytest_asyncio
from asterism.core.exceptions import UnauthorizedException
from asterism.core.schemas import AuthedUser
from asterism.domains.memory.policy import memory_available
from asterism.domains.user.models import UserModel
from sqlalchemy import update
from test_chat_models import new_chat
from test_class_mode_policy import course as _course
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
course = _course
AVAILABILITY = "/users/me/memories/availability"


@pytest_asyncio.fixture
async def memory(course, monkeypatch):
    """``course`` (student ``a`` in ``teach``'s class) plus an ``admin`` token."""

    def verify_token(token):
        if token not in ("a", "b", "teach", "admin"):
            raise UnauthorizedException()
        return AuthedUser(
            id=token,
            email=f"{token}@example.test",
            name="Dr Teach" if token == "teach" else token,
            role="admin" if token == "admin" else "user",
        )

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", verify_token)
    async with course["sessions"]() as session:
        session.add(UserModel(id="admin", name="Admin"))
        await session.commit()
    return course


async def set_memory_policy(memory, **policy):
    return await memory["client"].put("/settings/app/memory", headers=auth("admin"), json=policy)


async def availability(memory, user="a", **params):
    response = await memory["client"].get(AVAILABILITY, headers=auth(user), params=params)
    assert response.status_code == 200, response.text
    return response.json()


async def set_course_memory(memory, enabled):
    return await memory["client"].put(
        f"/classes/{memory['class']}/mode-policy",
        headers=auth("teach"),
        json={"allowed_modes": None, "answer_reveal": True, "memory_enabled": enabled},
    )


async def test_policy_is_off_by_default_and_admin_only(memory):
    client = memory["client"]
    assert (await client.get("/settings/app/memory", headers=auth("a"))).status_code == 403
    assert (await client.put("/settings/app/memory", headers=auth("a"), json={"enabled": True})).status_code == 403
    assert (await client.get("/settings/app/memory", headers=auth("admin"))).json() == {
        "enabled": False,
        "group_ids": None,
    }
    saved = await set_memory_policy(memory, enabled=True)
    assert saved.json() == {"enabled": True, "group_ids": None}
    assert (await client.get("/settings/app/memory", headers=auth("admin"))).json()["enabled"] is True


async def test_policy_off_names_the_admin(memory):
    assert (await client_get_policy(memory)) == {"enabled": False, "group_ids": None}
    assert await availability(memory) == {
        "available": False,
        "off_by": "policy",
        "reason": "Your administrator has turned memory off",
    }
    settings = (await memory["client"].get("/settings/user", headers=auth())).json()
    assert settings["memory_enabled"] is True and "memory_allowed" not in settings
    admin_switches = (await memory["client"].get("/availability", headers=auth())).json()["memory"]
    assert admin_switches == {"available": False, "reason": "Your administrator has turned memory off"}


async def client_get_policy(memory):
    return (await memory["client"].get("/settings/app/memory", headers=auth("admin"))).json()


async def test_policy_validates_groups_and_limits_them(memory):
    bad = await set_memory_policy(memory, enabled=True, group_ids=["no-such-group"])
    assert bad.status_code == 400 and "no-such-group" in bad.json()["detail"]
    assert (await set_memory_policy(memory, enabled="yes")).status_code == 422
    saved = await set_memory_policy(memory, enabled=True, group_ids=["student", "educator", "student"])
    assert saved.json() == {"enabled": True, "group_ids": ["educator", "student"]}
    await set_memory_policy(memory, enabled=True, group_ids=["student"])

    async with memory["sessions"]() as session:
        await session.execute(update(UserModel).where(UserModel.id == "a").values(group_id="student"))
        await session.execute(update(UserModel).where(UserModel.id == "b").values(group_id="educator"))
        await session.commit()
    assert (await availability(memory))["available"] is True
    assert await availability(memory, user="b") == {
        "available": False,
        "off_by": "group",
        "reason": "Memory isn't available to your group",
    }
    assert (await memory["client"].get("/availability", headers=auth("b"))).json()["memory"]["available"] is False
    # An empty list allows no group; null allows every group.
    await set_memory_policy(memory, enabled=True, group_ids=[])
    assert (await availability(memory))["off_by"] == "group"
    await set_memory_policy(memory, enabled=True, group_ids=None)
    assert (await availability(memory, user="b"))["available"] is True


async def test_the_personal_setting_turns_memory_off_for_that_person(memory):
    client = memory["client"]
    await set_memory_policy(memory, enabled=True)
    assert (await client.get("/settings/user", headers=auth())).json()["memory_enabled"] is True
    assert (await client.get("/availability", headers=auth())).json()["memory"]["available"] is True
    assert (await client.put("/settings/user/memory_enabled", headers=auth(), json={"value": "off"})).status_code == 400
    assert (await client.put("/settings/user/memory_allowed", headers=auth(), json={"value": True})).status_code == 400
    saved = await client.put("/settings/user/memory_enabled", headers=auth(), json={"value": False})
    assert saved.status_code == 200, saved.text
    assert await availability(memory) == {
        "available": False,
        "off_by": "personal",
        "reason": "You've turned memory off in Your Asterism",
    }
    assert (await availability(memory, user="b"))["available"] is True
    # Clearing the setting goes back to the default, on.
    assert (await client.delete("/settings/user/memory_enabled", headers=auth())).status_code in (200, 204)
    assert (await availability(memory))["available"] is True


async def test_a_course_turns_memory_off_in_its_chats_only_and_shows_who(memory):
    client = memory["client"]
    await set_memory_policy(memory, enabled=True)
    saved = await set_course_memory(memory, False)
    assert saved.status_code == 200, saved.text
    assert saved.json()["memory_enabled"] is False

    assert await availability(memory, project_id=memory["project"]) == {
        "available": False,
        "off_by": "course",
        "reason": "Biology 101 (Dr Teach) has turned memory off for this course",
    }
    # The student's other project and General chats keep memory.
    assert (await availability(memory, project_id=memory["other"]))["available"] is True
    assert (await availability(memory))["available"] is True

    # The effective policy shows the course as the source, even with no mode limit.
    policy = (await client.get("/chat/mode-policy", params={"project_id": memory["project"]}, headers=auth())).json()
    assert policy["memory_enabled"] is False
    [source] = policy["sources"]
    assert (source["kind"], source["class_name"], source["set_by"], source["memory_enabled"]) == (
        "course",
        "Biology 101",
        "Dr Teach",
        False,
    )

    # A chat in the course project, by id.
    chat = await new_chat(client, project_id=memory["project"], learning_mode="standard")
    assert (await availability(memory, chat_id=chat["info"]["id"]))["off_by"] == "course"
    assert chat["info"]["mode_policy"]["memory_enabled"] is False

    # Only the class's educator changes it, and turning it back on is live.
    refused = await client.put(
        f"/classes/{memory['class']}/mode-policy",
        headers=auth("a"),
        json={"allowed_modes": None, "answer_reveal": True, "memory_enabled": True},
    )
    assert refused.status_code == 403
    await set_course_memory(memory, True)
    assert (await availability(memory, project_id=memory["project"]))["available"] is True
    assert (await client.get("/chat/mode-policy", params={"project_id": memory["project"]}, headers=auth())).json()[
        "sources"
    ] == []


async def test_the_switches_are_checked_in_order_and_live(memory):
    """The admin's switches come first, then the person's, then the course's."""
    async with memory["sessions"]() as session:
        project = uuid.UUID(memory["project"])
        await set_course_memory(memory, False)
        await memory["client"].put("/settings/user/memory_enabled", headers=auth(), json={"value": False})
        assert (await memory_available("a", session, project_id=project)).off_by == "policy"
        await set_memory_policy(memory, enabled=True)
        assert (await memory_available("a", session, project_id=project)).off_by == "personal"
        await memory["client"].put("/settings/user/memory_enabled", headers=auth(), json={"value": True})
        assert (await memory_available("a", session, project_id=project)).off_by == "course"
        await set_course_memory(memory, True)
        assert (await memory_available("a", session, project_id=project)).available is True


async def test_availability_of_another_persons_chat_reveals_nothing(memory):
    await set_memory_policy(memory, enabled=True)
    chat = await new_chat(memory["client"], project_id=memory["project"], learning_mode="standard")
    assert await availability(memory, user="b", chat_id=chat["info"]["id"]) == {
        "available": False,
        "off_by": None,
        "reason": "Chat not found",
    }
    assert (await availability(memory, user="b", chat_id=str(uuid.uuid4())))["reason"] == "Chat not found"


async def test_a_malformed_stored_policy_never_turns_memory_on(memory):
    from asterism.domains.settings.models import ApplicationSettingsModel

    async with memory["sessions"]() as session:
        session.add(ApplicationSettingsModel(key="memory", value={"enabled": True, "unexpected": 1}))
        await session.commit()
    assert (await availability(memory))["off_by"] == "policy"
