"""US-60.4: class mode policy narrows learning modes and reveals in course projects."""

import uuid

import pytest
import pytest_asyncio
from asterism.core.exceptions import ConflictException, UnauthorizedException
from asterism.core.schemas import AuthedUser
from asterism.domains.classes.models import ClassMemberModel, ClassModel
from asterism.domains.courses.models import CourseCopyModel, CourseVersionModel
from asterism.domains.user.models import UserModel
from sqlalchemy import delete, update
from test_chat_models import new_chat
from test_learning_mode_lock import put_mode
from test_projects_api import auth
from test_projects_api import project_api as _project_api
from test_skill_execution import finish
from test_tutor_hints import hint_level, raise_to, run, send

pytestmark = pytest.mark.asyncio
project_api = _project_api


@pytest_asyncio.fixture
async def course(project_api, monkeypatch):
    """User ``a`` is a student whose course project belongs to ``teach``'s class."""
    client, sessions, _ = project_api

    def verify_token(token):
        if token not in ("a", "b", "teach"):
            raise UnauthorizedException()
        return AuthedUser(
            id=token, email=f"{token}@example.test", name="Dr Teach" if token == "teach" else token, role="user"
        )

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", verify_token)
    project = (await client.post("/projects/", headers=auth(), json={"name": "Biology 101"})).json()["id"]
    other = (await client.post("/projects/", headers=auth(), json={"name": "Mine"})).json()["id"]
    class_id = uuid.uuid4()
    async with sessions() as session:
        session.add(UserModel(id="teach", name="Dr Teach", group_id="educator"))
        await session.flush()
        session.add(ClassModel(id=class_id, educator_id="teach", name="Biology 101", join_code="ABCDEFGH23"))
        await session.flush()
        session.add(ClassMemberModel(class_id=class_id, user_id="a"))
        version = CourseVersionModel(class_id=class_id, number=1, manifest="{}", models="{}")
        session.add(version)
        await session.flush()
        session.add(
            CourseCopyModel(class_id=class_id, user_id="a", version_id=version.id, project_id=uuid.UUID(project))
        )
        await session.commit()
    return {"client": client, "sessions": sessions, "class": class_id, "project": project, "other": other}


async def set_policy(course, allowed_modes, answer_reveal=True, user="teach"):
    return await course["client"].put(
        f"/classes/{course['class']}/mode-policy",
        headers=auth(user),
        json={"allowed_modes": allowed_modes, "answer_reveal": answer_reveal},
    )


async def policy_view(course, project=None):
    response = await course["client"].get(f"/course-policy/projects/{project or course['project']}", headers=auth())
    assert response.status_code == 200
    return response.json()


async def test_students_see_the_policy_and_who_set_it(course):
    assert await policy_view(course) is None
    response = await set_policy(course, ["tutor", "explain_back"], answer_reveal=False)
    assert response.status_code == 200, response.text
    assert response.json()["allowed_modes"] == ["tutor", "explain_back"]
    assert await policy_view(course) == {
        "class_name": "Biology 101",
        "educator_name": "Dr Teach",
        "allowed_modes": ["tutor", "explain_back"],
        "answer_reveal": False,
    }
    # The student's other projects are not limited.
    assert await policy_view(course, course["other"]) is None
    # US-64.2: "Set by" reads the educator's current name.
    async with course["sessions"]() as session:
        await session.execute(update(UserModel).where(UserModel.id == "teach").values(name="Prof Teach"))
        await session.commit()
    assert (await policy_view(course))["educator_name"] == "Prof Teach"


async def test_only_the_owning_educator_sets_policy_and_it_cannot_be_empty(course):
    assert (await set_policy(course, ["tutor"], user="a")).status_code == 403
    assert (await set_policy(course, [])).status_code == 422
    assert (await set_policy(course, ["tutor", "tutor"])).status_code == 422
    assert (await set_policy(course, ["made_up"])).status_code == 422


async def test_a_forbidden_mode_is_refused_on_send_and_on_mode_change(course):
    await set_policy(course, ["tutor"])
    refused = await course["client"].post(
        "/chat/",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Hi",
            "model_id": str(uuid.UUID(int=1)),
            "project_id": course["project"],
            "learning_mode": "standard",
        },
    )
    assert refused.status_code == 409 and "allows only Tutor mode" in refused.json()["detail"]
    assert "Dr Teach set this for Biology 101" in refused.json()["detail"]

    chat = await new_chat(course["client"], project_id=course["project"], learning_mode="tutor")
    cid = chat["info"]["id"]
    assert (await put_mode(course["client"], cid, "standard", 1)).status_code == 409
    # The same mode is fine outside the course project.
    assert (await new_chat(course["client"], project_id=course["other"]))["info"]["learning_mode"] == "standard"


async def test_policy_is_checked_live_before_every_run(course):
    chat = await new_chat(course["client"], project_id=course["project"], learning_mode="standard")
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    # Tightened after the turn was accepted: its run is refused, then allowed again once loosened.
    await set_policy(course, ["tutor"])
    with pytest.raises(ConflictException, match="allows only Tutor"):
        await run(course["sessions"], cid, first)
    await set_policy(course, None)
    assert (await run(course["sessions"], cid, first)).learning_mode.id == "standard"


async def test_answer_reveal_can_be_turned_off(course):
    chat = await new_chat(course["client"], project_id=course["project"], learning_mode="tutor")
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    await finish(course["sessions"], first)
    nudge = await raise_to(course["client"], course["sessions"], cid, first, "nudge")
    answer = await raise_to(course["client"], course["sessions"], cid, nudge["id"], "answer", confirm_reveal=True)

    await set_policy(course, None, answer_reveal=False)
    refused = await send(
        course["client"], cid, answer["id"], hint={"level": "answer", "confirm_reveal": True, "reset": True}
    )
    assert refused.status_code == 409 and "Showing answers is turned off" in refused.json()["detail"]
    # A branch already at the answer continues one level below it.
    later = await send(course["client"], cid, answer["id"])
    assert later.status_code == 200, later.text
    await finish(course["sessions"], later.json()["id"])
    assert await hint_level(course["client"], cid) == "worked_example"
    # Regenerating the earlier reveal is refused while the policy holds.
    with pytest.raises(ConflictException, match="Showing answers is turned off"):
        await run(course["sessions"], cid, answer["id"], restart=True)


async def test_policy_stops_applying_when_the_student_leaves(course):
    await set_policy(course, ["tutor"])
    async with course["sessions"]() as session:
        await session.execute(delete(ClassMemberModel).where(ClassMemberModel.user_id == "a"))
        await session.commit()
    assert await policy_view(course) is None
    assert (await new_chat(course["client"], project_id=course["project"]))["info"]["learning_mode"] == "standard"


async def test_a_retired_stored_mode_never_widens_the_policy(course):
    async with course["sessions"]() as session:
        await session.execute(update(ClassModel).values(allowed_modes=["retired_mode"]))
        await session.commit()
    assert (await policy_view(course))["allowed_modes"] == []
    response = await course["client"].post(
        "/chat/",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Hi",
            "model_id": str(uuid.UUID(int=1)),
            "project_id": course["project"],
            "learning_mode": "tutor",
        },
    )
    assert response.status_code == 409
