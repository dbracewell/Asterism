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
    """The course source of a new chat's effective policy, or None when nothing is limited."""
    response = await course["client"].get(
        "/chat/mode-policy", params={"project_id": project or course["project"]}, headers=auth()
    )
    assert response.status_code == 200
    sources = response.json()["sources"]
    return next((source for source in sources if source["kind"] == "course"), None)


async def test_students_see_the_policy_and_who_set_it(course):
    assert await policy_view(course) is None
    response = await set_policy(course, ["tutor", "explain_back"], answer_reveal=False)
    assert response.status_code == 200, response.text
    assert response.json()["allowed_modes"] == ["tutor", "explain_back"]
    assert await policy_view(course) == {
        "kind": "course",
        "class_name": "Biology 101",
        "set_by": "Dr Teach",
        "allowed_modes": ["tutor", "explain_back"],
        "reveal": "forbidden",
        "learner_can_lift": False,
        "memory_enabled": True,
    }
    # The student's other projects are not limited.
    assert await policy_view(course, course["other"]) is None
    # US-64.2: "Set by" reads the educator's current name.
    async with course["sessions"]() as session:
        await session.execute(update(UserModel).where(UserModel.id == "teach").values(name="Prof Teach"))
        await session.commit()
    assert (await policy_view(course))["set_by"] == "Prof Teach"


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
    assert refused.status_code == 409 and "Biology 101 (Dr Teach): Tutor only" in refused.json()["detail"]
    assert refused.json()["reason"] == "mode_policy"

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
    with pytest.raises(ConflictException, match=r"Biology 101 \(Dr Teach\): Tutor only"):
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
    assert refused.status_code == 409 and "answers can't be revealed" in refused.json()["detail"]
    # A branch already at the answer continues one level below it.
    later = await send(course["client"], cid, answer["id"])
    assert later.status_code == 200, later.text
    await finish(course["sessions"], later.json()["id"])
    assert await hint_level(course["client"], cid) == "worked_example"
    # Regenerating the earlier reveal is refused while the policy holds.
    with pytest.raises(ConflictException, match="answers can't be revealed"):
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


async def tutor_chat_in_course(course):
    chat = await new_chat(course["client"], project_id=course["project"], learning_mode="tutor")
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    await finish(course["sessions"], first)
    return cid, first


async def chat_info(course, cid):
    return (await course["client"].get(f"/chat/{cid}", headers=auth())).json()["info"]


async def test_both_sources_combine_and_the_stricter_rule_wins(course):
    """US-85.1: modes intersect, reveal takes the strictest source, each source is named."""
    await set_policy(course, ["tutor", "explain_back", "standard"], answer_reveal=False)
    cid, first = await tutor_chat_in_course(course)
    locked = await put_mode(course["client"], cid, "tutor", 1, locked=True)
    assert locked.status_code == 200, locked.text
    policy = locked.json()["mode_policy"]
    assert policy["allowed_modes"] == ["tutor", "explain_back"]
    assert policy["reveal"] == "forbidden"
    assert [source["kind"] for source in policy["sources"]] == ["course", "learner"]

    nudge = await raise_to(course["client"], course["sessions"], cid, first, "nudge")
    both = await send(course["client"], cid, nudge["id"], hint={"level": "answer", "confirm_reveal": True})
    assert both.status_code == 409 and both.json()["reason"] == "mode_policy"
    assert "You locked this chat" in both.json()["detail"]
    assert "Biology 101 (Dr Teach): answers can't be revealed" in both.json()["detail"]
    # The override lifts only the learner's part; the course still refuses.
    course_only = await send(
        course["client"], cid, nudge["id"], hint={"level": "answer", "confirm_reveal": True, "override_lock": True}
    )
    assert course_only.status_code == 409
    assert "You locked" not in course_only.json()["detail"]
    assert "answers can't be revealed" in course_only.json()["detail"]


async def test_the_override_cannot_switch_to_a_standard_the_course_forbids(course):
    await set_policy(course, ["tutor"])
    cid, _ = await tutor_chat_in_course(course)
    assert (await put_mode(course["client"], cid, "tutor", 1, locked=True)).status_code == 200
    refused = await put_mode(course["client"], cid, "standard", 2, override_lock=True)
    assert refused.status_code == 409 and "Biology 101 (Dr Teach): Tutor only" in refused.json()["detail"]
    # Nothing changed: still Tutor, still locked.
    current = await chat_info(course, cid)
    assert current["learning_mode"] == "tutor" and current["learning_mode_revision"] == 2
    assert [source["kind"] for source in current["mode_policy"]["sources"]] == ["course", "learner"]
    # Unlocking alone is the learner's to do.
    unlocked = await put_mode(course["client"], cid, "tutor", 2, locked=False, override_lock=True)
    assert unlocked.status_code == 200
    assert [source["kind"] for source in unlocked.json()["mode_policy"]["sources"]] == ["course"]


async def test_an_empty_intersection_refuses_the_lock_and_later_offers_unlocking(course):
    cid, first = await tutor_chat_in_course(course)
    other_cid, _ = await tutor_chat_in_course(course)
    assert (await put_mode(course["client"], cid, "tutor", 1, locked=True)).status_code == 200
    await set_policy(course, ["standard"])
    # Locking now would leave no mode at all.
    refused_lock = await put_mode(course["client"], other_cid, "tutor", 1, locked=True)
    assert refused_lock.status_code == 409 and "can't be locked" in refused_lock.json()["detail"]
    # The chat locked earlier: sends are refused, and the refusal offers unlocking.
    assert (await chat_info(course, cid))["mode_policy"]["allowed_modes"] == []
    refused = await send(course["client"], cid, first)
    assert refused.status_code == 409
    assert "Standard only" in refused.json()["detail"] and "unlock it to continue" in refused.json()["detail"]
    # Switching to Standard releases the lock and is allowed by the course.
    left = await put_mode(course["client"], cid, "standard", 2, override_lock=True)
    assert left.status_code == 200, left.text
    assert (await send(course["client"], cid, first)).status_code == 200


async def test_tightening_after_acceptance_stops_resume_and_regeneration(course):
    cid, first = await tutor_chat_in_course(course)
    follow = await send(course["client"], cid, first)
    assert follow.status_code == 200
    follow_id = follow.json()["id"]
    await run(course["sessions"], cid, follow_id)  # records the execution
    await set_policy(course, ["explain_back"])
    with pytest.raises(ConflictException, match="Explain-back only"):
        await run(course["sessions"], cid, follow_id)  # resume of the recorded run
    with pytest.raises(ConflictException, match="Explain-back only"):
        await run(course["sessions"], cid, first, restart=True)


async def test_the_learner_lock_alone_does_not_stop_a_run(course):
    """A run checks only sources the learner cannot lift; the lock gated acceptance."""
    cid, first = await tutor_chat_in_course(course)
    nudge = await raise_to(course["client"], course["sessions"], cid, first, "nudge")
    answer = await raise_to(course["client"], course["sessions"], cid, nudge["id"], "answer", confirm_reveal=True)
    assert (await put_mode(course["client"], cid, "tutor", 1, locked=True)).status_code == 200
    regenerated = await run(course["sessions"], cid, answer["id"], restart=True)
    assert regenerated.learning_mode.hint_level == "answer"
