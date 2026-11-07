"""US-60.5: thresholded, consent-based class insights from study results."""

import json
import uuid

import pytest
import pytest_asyncio
from asterism.domains.classes.models import ClassMemberModel
from asterism.domains.courses.insights import MIN_GROUP_SIZE
from asterism.domains.courses.models import CourseCopyItemModel, CourseCopyModel, CourseItemType, CourseVersionModel
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.projects.models import ProjectModel
from asterism.domains.study.models import StudyCardModel, StudyDeckModel, StudyReviewLogModel
from asterism.domains.user.models import UserModel
from sqlalchemy import update
from test_classes import api as _api
from test_classes import join, make_class
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
api = _api
AGAIN, GOOD = 1, 3


@pytest_asyncio.fixture
async def klass(api):
    client, sessions = api
    created = await make_class(client)
    async with sessions() as session:
        version = CourseVersionModel(class_id=uuid.UUID(created["id"]), number=1, manifest="{}", models="{}")
        session.add(version)
        await session.commit()
    return {"client": client, "sessions": sessions, "id": uuid.UUID(created["id"]), "version": version.id}


async def add_student(klass, user_id, ratings, consent=True, own_file_rating=None):
    """A member with a course copy whose cards cite course files; ``ratings`` maps file name to card rating."""
    async with klass["sessions"]() as session:
        session.add(UserModel(id=user_id))
        await session.flush()
        project = ProjectModel(user_id=user_id, name="Course")
        session.add(project)
        session.add(
            ClassMemberModel(class_id=klass["id"], user_id=user_id, display_name=user_id, insights_consent=consent)
        )
        await session.flush()
        session.add(
            CourseCopyModel(class_id=klass["id"], user_id=user_id, version_id=klass["version"], project_id=project.id)
        )
        deck = StudyDeckModel(user_id=user_id, project_id=project.id, name="Deck")
        session.add(deck)
        await session.flush()
        files = dict(ratings)
        if own_file_rating is not None:
            files["mine.txt"] = own_file_rating
        for name, rating in files.items():
            file = UserFileModel(
                user_id=user_id,
                storage_key=f"{user_id}/{name}",
                filename=name,
                original_name=name,
                size=1,
                mime_type="text/plain",
                kind=FileKind.TEXT,
                sha256="0" * 64,
            )
            session.add(file)
            await session.flush()
            if name != "mine.txt":
                session.add(
                    CourseCopyItemModel(
                        class_id=klass["id"],
                        user_id=user_id,
                        item_type=CourseItemType.FILE,
                        item_key=name,
                        record_id=file.id,
                        sha256="0" * 64,
                    )
                )
            card = StudyCardModel(
                user_id=user_id,
                deck_id=deck.id,
                front="secret question text",
                back="secret answer",
                citations=json.dumps([{"file_id": str(file.id)}]),
            )
            session.add(card)
            await session.flush()
            session.add(
                StudyReviewLogModel(
                    user_id=user_id,
                    card_id=card.id,
                    rating=rating,
                    reviewed_at=1_700_000_000,
                    previous_state="learning",
                    previous_due_at=0,
                    state="review",
                    due_at=0,
                    stability=1.0,
                    difficulty=5.0,
                )
            )
        await session.commit()


async def insights(klass, user="teach"):
    return await klass["client"].get(f"/classes/{klass['id']}/insights", headers=auth(user))


async def test_nothing_is_shown_until_enough_students_consent(klass):
    for n in range(MIN_GROUP_SIZE - 1):
        await add_student(klass, f"st{n}", {"cells.txt": AGAIN})
    await add_student(klass, "declined", {"cells.txt": AGAIN}, consent=False)
    body = (await insights(klass)).json()
    assert body == {"min_group_size": 5, "consenting_students": 4, "topics": [], "hidden_topics": 0}


async def test_weak_topics_are_aggregated_rounded_and_thresholded(klass):
    for n in range(4):
        await add_student(klass, f"st{n}", {"cells.txt": AGAIN, "energy.txt": GOOD}, own_file_rating=AGAIN)
    await add_student(klass, "st4", {"cells.txt": GOOD, "energy.txt": GOOD, "rare.txt": AGAIN})
    body = (await insights(klass)).json()
    assert body["consenting_students"] == 5
    assert body["topics"] == [
        {"name": "cells.txt", "students": 5, "average_score": 0.2, "needs_work_share": 0.8},
        {"name": "energy.txt", "students": 5, "average_score": 0.9, "needs_work_share": 0.0},
    ]
    # Only one student practiced rare.txt, and students' own files never count.
    assert body["hidden_topics"] == 1
    text = json.dumps(body)
    for private in ("st0", "secret", "mine.txt", "rare.txt"):
        assert private not in text


async def test_withdrawn_consent_and_removed_students_drop_out_at_once(klass):
    for n in range(MIN_GROUP_SIZE):
        await add_student(klass, f"st{n}", {"cells.txt": AGAIN})
    assert len((await insights(klass)).json()["topics"]) == 1
    async with klass["sessions"]() as session:
        await session.execute(
            update(ClassMemberModel).where(ClassMemberModel.user_id == "st0").values(insights_consent=False)
        )
        await session.commit()
    assert (await insights(klass)).json()["topics"] == []
    async with klass["sessions"]() as session:
        await session.execute(
            update(ClassMemberModel).where(ClassMemberModel.user_id == "st0").values(insights_consent=True)
        )
        await session.execute(update(ClassMemberModel).where(ClassMemberModel.user_id == "st1").values(removed_at=1))
        await session.commit()
    assert (await insights(klass)).json()["consenting_students"] == 4


async def test_only_the_owning_educator_sees_insights(klass):
    assert (await insights(klass, "other")).status_code == 404
    assert (await insights(klass, "s1")).status_code == 403


async def test_students_opt_in_and_out(klass):
    client = klass["client"]
    joined = await client.get("/classes/joined", headers=auth("s1"))
    assert joined.json()["items"] == []
    code = (await client.get(f"/classes/{klass['id']}", headers=auth("teach"))).json()["join_code"]
    assert (await join(client, code)).json()["insights_consent"] is False
    url = f"/classes/joined/{klass['id']}/insights-consent"
    opted = await client.put(url, headers=auth("s1"), json={"consent": True})
    assert opted.status_code == 200 and opted.json()["insights_consent"] is True
    assert (await client.get("/classes/joined", headers=auth("s1"))).json()["items"][0]["insights_consent"] is True
    assert (await client.put(url, headers=auth("s1"), json={"consent": False})).json()["insights_consent"] is False
    # Not a member: the same 404 as a missing class.
    assert (await client.put(url, headers=auth("s2"), json={"consent": True})).status_code == 404
