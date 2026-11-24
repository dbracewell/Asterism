"""EPIC-96: ``GET /availability`` reports the admin's live switches for the caller."""

import pytest
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.user.models import UserModel
from sqlalchemy import update
from test_class_mode_policy import course as _course
from test_memory_policy import memory as _memory
from test_memory_policy import set_memory_policy
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
course = _course
memory = _memory

FEATURES = {"memory", "canvas", "image_generation", "skills", "chatgpt_plans", "delegation"}


async def read(memory, user="a"):
    response = await memory["client"].get("/availability", headers=auth(user))
    assert response.status_code == 200, response.text
    return response.json()


async def store(memory, **settings):
    async with memory["sessions"]() as session:
        for key, value in settings.items():
            await session.merge(ApplicationSettingsModel(key=key, value=value))
        await session.commit()


async def test_everything_is_off_by_default_with_a_reason(memory):
    body = await read(memory)
    assert set(body) == FEATURES
    for feature, state in body.items():
        assert state["available"] is False, feature
        assert state["reason"], feature


async def test_each_admin_switch_is_read_live(memory):
    await store(
        memory,
        canvas_enabled=True,
        skills_enabled=True,
        chatgpt_plan_enabled=True,
        active_tools=["sub_agent"],
    )
    await set_memory_policy(memory, enabled=True)
    body = await read(memory)
    for feature in ("memory", "canvas", "skills", "chatgpt_plans", "delegation"):
        assert body[feature] == {"available": True, "reason": ""}, feature
    # Image generation also needs a ready provider, so it stays off here.
    assert body["image_generation"]["available"] is False

    await store(memory, canvas_enabled=False)
    assert (await read(memory))["canvas"]["available"] is False


async def test_malformed_writes_never_turn_a_switch_on(memory):
    await store(memory, canvas_enabled="yes", skills_enabled=1, chatgpt_plan_enabled="true")
    body = await read(memory)
    assert not any(body[feature]["available"] for feature in ("canvas", "skills", "chatgpt_plans"))


async def test_group_limits_apply_to_the_caller(memory):
    await set_memory_policy(memory, enabled=True, group_ids=["student"])
    async with memory["sessions"]() as session:
        await session.execute(update(UserModel).where(UserModel.id == "a").values(group_id="student"))
        await session.execute(update(UserModel).where(UserModel.id == "b").values(group_id="educator"))
        await session.commit()
    assert (await read(memory, "a"))["memory"]["available"] is True
    assert (await read(memory, "b"))["memory"] == {
        "available": False,
        "reason": "Memory isn't available to your group",
    }


async def test_requires_sign_in(memory):
    assert (await memory["client"].get("/availability")).status_code == 401
