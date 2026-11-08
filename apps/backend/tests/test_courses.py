"""US-60.3: educators publish course versions; students add and update their own copy."""

import hashlib
import uuid

import pytest
import pytest_asyncio
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.courses.models import CourseFileModel
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.files.store import LocalFileStore
from asterism.domains.projects.models import ProjectFileModel, ProjectModel, ProjectSubAgentModel
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel
from asterism.domains.tools.registry import tool_registry
from sqlalchemy import select, update
from test_classes import api as _api
from test_classes import join, make_class
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
api = _api
MODEL = uuid.UUID(int=1)
OTHER_MODEL = uuid.UUID(int=2)


@pytest_asyncio.fixture
async def course(api, monkeypatch, tmp_path):
    client, sessions = api
    root = tmp_path / "sources"
    store = LocalFileStore(root)
    for module in ("files.service", "courses.publish", "courses.copies", "courses.storage"):
        monkeypatch.setattr(f"asterism.domains.{module}.get_file_store", lambda: store)
    monkeypatch.setattr("asterism.domains.files.service.start_ingestion", lambda **_: None)
    monkeypatch.setattr("asterism.domains.files.service.delete_file_vectors", _no_vectors)

    # Admin policy allows web_search here, but not image_generation.
    monkeypatch.setitem(tool_registry.registry, "web_search", object())

    klass = await make_class(client)
    project = (
        await client.post(
            "/projects/",
            headers=auth("teach"),
            json={"name": "Bio setup", "system_prompt": "Be Socratic.", "goal": "Cells"},
        )
    ).json()
    tutor = AgentProfileModel(
        id=uuid.uuid4(),
        user_id="teach",
        sub_agent=True,
        model_id=MODEL,
        name="Tutor",
        description="Asks questions.",
        system_prompt="Never give the answer.",
        max_steps=5,
        chat_parameters={"temperature": 0.3},
        tools=["web_search", "image_generation"],
    )
    async with sessions() as session:
        await session.execute(update(LLMModel).where(LLMModel.id == MODEL).values(supports_tools=True))
        session.add(ApplicationSettingsModel(key="active_tools", value=["web_search"]))
        session.add(tutor)
        await session.flush()
        session.add(ProjectSubAgentModel(project_id=uuid.UUID(project["id"]), agent_id=tutor.id, user_id="teach"))
        await session.commit()
    state = {
        "client": client,
        "sessions": sessions,
        "store": store,
        "class": klass,
        "project": project["id"],
        "tutor": tutor.id,
    }
    await add_file(state, "notes.txt", b"cells have membranes")
    assert (await join(client, klass["join_code"], user="s1")).status_code == 200
    return state


async def _no_vectors(**_):
    return None


async def add_file(state, name, content):
    file_id = uuid.uuid4()
    key = state["store"].save("teach", file_id, ".txt", content)
    async with state["sessions"]() as session:
        session.add(
            UserFileModel(
                id=file_id,
                storage_key=key,
                user_id="teach",
                filename=name,
                original_name=name,
                size=len(content),
                mime_type="text/plain",
                kind=FileKind.TEXT,
                sha256=hashlib.sha256(content).hexdigest(),
            )
        )
        await session.flush()
        session.add(ProjectFileModel(project_id=uuid.UUID(state["project"]), file_id=file_id, user_id="teach"))
        await session.commit()
    return file_id


async def publish(state, note="", user="teach"):
    return await state["client"].post(
        f"/classes/{state['class']['id']}/course",
        headers=auth(user),
        json={"project_id": state["project"], "note": note},
    )


async def offer(state, user="s1"):
    return await state["client"].get(f"/classes/joined/{state['class']['id']}/course", headers=auth(user))


async def apply(state, version, user="s1"):
    return await state["client"].post(
        f"/classes/joined/{state['class']['id']}/course", headers=auth(user), json={"version_number": version}
    )


async def student_records(state, user="s1"):
    async with state["sessions"]() as session:
        projects = list(await session.scalars(select(ProjectModel).where(ProjectModel.user_id == user)))
        agents = list(
            await session.scalars(
                select(AgentProfileModel).where(
                    AgentProfileModel.user_id == user, AgentProfileModel.sub_agent.is_(True)
                )
            )
        )
        files = list(await session.scalars(select(UserFileModel).where(UserFileModel.user_id == user)))
        links = list(await session.scalars(select(ProjectFileModel).where(ProjectFileModel.user_id == user)))
        picks = list(await session.scalars(select(ProjectSubAgentModel).where(ProjectSubAgentModel.user_id == user)))
    return projects, agents, files, links, picks


async def test_a_student_adds_the_course_as_their_own_project(course):
    assert (await offer(course)).json() is None
    published = await publish(course, note="First week")
    assert published.status_code == 201, published.text
    assert published.json()["number"] == 1 and published.json()["file_names"] == ["notes.txt"]

    shown = (await offer(course)).json()
    assert shown["version_number"] == 1 and shown["note"] == "First week" and shown["current"] is None
    assert shown["instructions"] == "Be Socratic."
    # Tools are what admin policy allows now, not everything the educator had.
    assert shown["sub_agents"] == [
        {"name": "Tutor", "description": "Asks questions.", "model_name": "Chat A", "tools": ["web_search"]}
    ]
    assert shown["files"] == [{"name": "notes.txt", "size": 20}]

    applied = await apply(course, 1)
    assert applied.status_code == 200, applied.text
    projects, agents, files, links, picks = await student_records(course)
    [project] = projects
    assert (project.name, project.system_prompt, project.goal) == ("Biology 101", "Be Socratic.", "Cells")
    [agent] = agents
    assert (agent.name, agent.model_id, agent.tools, agent.system_prompt) == (
        "Tutor",
        MODEL,
        ["web_search"],
        "Never give the answer.",
    )
    assert agent.id != course["tutor"]
    [file] = files
    assert file.filename == "notes.txt" and course["store"].open("s1", file.storage_key).read_bytes() == (
        b"cells have membranes"
    )
    assert [(link.project_id, link.file_id) for link in links] == [(project.id, file.id)]
    assert [(pick.project_id, pick.agent_id) for pick in picks] == [(project.id, agent.id)]
    assert (await offer(course)).json()["current"] == {"version_number": 1, "project_id": str(project.id)}


async def test_an_update_changes_course_records_in_place_and_lists_what_changed(course):
    await publish(course)
    await apply(course, 1)
    _, [agent_before], [file_before], _, _ = await student_records(course)

    critic = AgentProfileModel(
        id=uuid.uuid4(),
        user_id="teach",
        sub_agent=True,
        model_id=OTHER_MODEL,
        name="Critic",
        description="",
        system_prompt="Check reasoning.",
        tools=[],
    )
    async with course["sessions"]() as session:
        session.add(critic)
        await session.flush()
        session.add(ProjectSubAgentModel(project_id=uuid.UUID(course["project"]), agent_id=critic.id, user_id="teach"))
        await session.execute(
            update(AgentProfileModel)
            .where(AgentProfileModel.id == course["tutor"])
            .values(system_prompt="Give hints only.")
        )
        old = await session.scalar(select(UserFileModel).where(UserFileModel.user_id == "teach"))
        await session.delete(old)
        await session.commit()
    await add_file(course, "week2.txt", b"mitochondria")
    assert (await publish(course, note="Week two")).json()["number"] == 2

    shown = (await offer(course)).json()
    assert shown["current"]["version_number"] == 1
    assert {(change["kind"], change["item"], change["name"]) for change in shown["changes"]} == {
        ("added", "sub_agent", "Critic"),
        ("changed", "sub_agent", "Tutor"),
        ("added", "file", "week2.txt"),
        ("removed", "file", "notes.txt"),
    }

    assert (await apply(course, 2)).status_code == 200
    [project], agents, files, links, picks = await student_records(course)
    by_name = {agent.name: agent for agent in agents}
    assert by_name["Tutor"].id == agent_before.id and by_name["Tutor"].system_prompt == "Give hints only."
    assert by_name["Critic"].model_id == OTHER_MODEL
    assert [file.filename for file in files] == ["week2.txt"] and files[0].id != file_before.id
    assert {pick.agent_id for pick in picks} == {agent.id for agent in agents}
    assert {link.file_id for link in links} == {files[0].id}
    assert (await offer(course)).json()["changes"] == []

    # Removing a sub-agent from the course removes the student's copy of it.
    async with course["sessions"]() as session:
        await session.execute(ProjectSubAgentModel.__table__.delete().where(ProjectSubAgentModel.agent_id == critic.id))
        await session.commit()
    await publish(course)
    assert ("removed", "sub_agent", "Critic") in {
        (c["kind"], c["item"], c["name"]) for c in (await offer(course)).json()["changes"]
    }
    await apply(course, 3)
    _, agents, *_ = await student_records(course)
    assert [agent.name for agent in agents] == ["Tutor"]


async def test_only_the_reviewed_version_can_be_applied(course):
    await publish(course)
    await publish(course)
    response = await apply(course, 1)
    assert response.status_code == 409
    assert (await student_records(course))[0] == []


async def test_published_versions_do_not_follow_later_edits(course):
    await publish(course)
    async with course["sessions"]() as session:
        await session.execute(
            update(AgentProfileModel).where(AgentProfileModel.id == course["tutor"]).values(system_prompt="Changed")
        )
        await session.commit()
    await apply(course, 1)
    _, [agent], *_ = await student_records(course)
    assert agent.system_prompt == "Never give the answer."


async def test_name_clashes_get_the_class_name(course):
    async with course["sessions"]() as session:
        session.add(
            AgentProfileModel(user_id="s1", sub_agent=True, model_id=MODEL, name="tutor", description="", tools=[])
        )
        session.add(ProjectModel(user_id="s1", name="Biology 101"))
        await session.commit()
    await publish(course)
    assert (await apply(course, 1)).status_code == 200
    projects, agents, *_ = await student_records(course)
    assert sorted(project.name for project in projects) == ["Biology 101", "Biology 101 (course)"]
    assert sorted(agent.name for agent in agents) == ["Tutor (Biology 101)", "tutor"]


async def test_a_deleted_course_project_is_made_again(course):
    await publish(course)
    await apply(course, 1)
    async with course["sessions"]() as session:
        project = await session.scalar(select(ProjectModel).where(ProjectModel.user_id == "s1"))
        await session.delete(project)
        await session.commit()
    assert (await offer(course)).json()["current"] == {"version_number": 1, "project_id": None}
    assert (await apply(course, 1)).status_code == 200
    [project], agents, files, links, picks = await student_records(course)
    assert len(agents) == 1 and len(files) == 1 and len(links) == 1 and len(picks) == 1


async def test_an_unavailable_model_stops_the_add(course):
    await publish(course)
    async with course["sessions"]() as session:
        await session.execute(update(LLMModel).where(LLMModel.id == MODEL).values(is_active=False))
        await session.commit()
    assert (await offer(course)).json()["sub_agents"][0]["model_name"] is None
    response = await apply(course, 1)
    assert response.status_code == 400 and "isn't available to you" in response.json()["detail"]
    assert (await student_records(course))[0] == []


async def test_only_members_and_the_owning_educator_reach_the_course(course):
    await publish(course)
    for user in ("s2", "other", "teach"):
        assert (await offer(course, user=user)).status_code == 404
        assert (await apply(course, 1, user=user)).status_code == 404
    assert (await publish(course, user="other")).status_code == 404
    assert (await publish(course, user="s1")).status_code == 403
    # Educators can only publish their own projects.
    other_project = (await course["client"].post("/projects/", headers=auth("other"), json={"name": "X"})).json()
    response = await course["client"].post(
        f"/classes/{course['class']['id']}/course",
        headers=auth("teach"),
        json={"project_id": other_project["id"]},
    )
    assert response.status_code == 404

    await course["client"].delete(f"/classes/{course['class']['id']}/members/s1", headers=auth("teach"))
    assert (await offer(course)).status_code == 404


async def test_only_the_latest_version_keeps_file_bytes_and_deleting_the_class_removes_them(course):
    await publish(course)
    await add_file(course, "extra.txt", b"more")
    await publish(course)
    async with course["sessions"]() as session:
        rows = list(await session.scalars(select(CourseFileModel)))
    kept = [row.storage_key for row in rows if row.storage_key]
    assert len(rows) == 3 and len(kept) == 2
    # The unchanged file moved to the new version instead of being copied.
    assert len({row.sha256 for row in rows}) == 2
    paths = [course["store"].open("teach", key) for key in kept]
    assert all(path.is_file() for path in paths)
    response = await course["client"].delete(f"/classes/{course['class']['id']}", headers=auth("teach"))
    assert response.status_code == 204
    assert not any(path.exists() for path in paths)


async def test_versions_are_listed_for_the_educator(course):
    await publish(course, note="one")
    await publish(course, note="two")
    page = (
        await course["client"].get(f"/classes/{course['class']['id']}/course/versions", headers=auth("teach"))
    ).json()
    assert [(item["number"], item["note"], item["sub_agent_names"]) for item in page["items"]] == [
        (2, "two", ["Tutor"]),
        (1, "one", ["Tutor"]),
    ]


async def test_course_projects_carry_the_feature_areas(course):
    # The educator hides Study, but a course project always shows it.
    areas = {"study": False, "reflections": False, "goal": True, "sub_agents": False}
    path = f"/projects/{course['project']}"
    revision = (await course["client"].get(path, headers=auth("teach"))).json()["context_revision"]
    edited = await course["client"].patch(
        path, headers=auth("teach"), json={"expected_context_revision": revision, "areas": areas}
    )
    assert edited.status_code == 200, edited.text
    await publish(course)
    await apply(course, 1)
    [project], *_ = await student_records(course)
    assert project.areas.model_dump() == areas | {"study": True}

    revision = (await course["client"].get(path, headers=auth("teach"))).json()["context_revision"]
    await course["client"].patch(
        path, headers=auth("teach"), json={"expected_context_revision": revision, "areas": areas | {"goal": False}}
    )
    await publish(course)
    assert ("changed", "settings") in {(c["kind"], c["item"]) for c in (await offer(course)).json()["changes"]}
    await apply(course, 2)
    [project], *_ = await student_records(course)
    assert project.areas.goal is False
