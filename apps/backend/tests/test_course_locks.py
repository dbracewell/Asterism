"""US-67.1: course-managed records are read-only to the student; course updates still apply."""

import uuid

import pytest
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.projects.models import ProjectModel
from sqlalchemy import update
from test_courses import MODEL, apply, publish, student_records
from test_courses import api as _api
from test_courses import course as _course
from test_courses import project_api as _project_api
from test_projects_api import auth

pytestmark = pytest.mark.asyncio
project_api = _project_api
api = _api
course = _course


async def added(state):
    """Publish and add the course; return the student's project, sub-agent and file."""
    await publish(state)
    assert (await apply(state, 1)).status_code == 200
    [project], [agent], [file], _, _ = await student_records(state)
    return project, agent, file


def sub_agent_payload(name="Tutor"):
    return {"name": name, "model_id": str(MODEL), "system_prompt": "Mine now."}


async def own_records(state):
    """A project, sub-agent and file the student made themselves."""
    client = state["client"]
    project = (await client.post("/projects/", headers=auth("s1"), json={"name": "Mine"})).json()
    agent = (await client.post("/agents/sub-agents", headers=auth("s1"), json=sub_agent_payload("Helper"))).json()
    upload = await client.post("/files/", headers=auth("s1"), files=[("files", ("own.txt", b"own", "text/plain"))])
    assert upload.status_code < 300, upload.text
    [file] = upload.json()["files"]
    return project, agent, file


def attempts(project_id, revision, agent_id, agent_revision, file_id, filename):
    """Every guarded write a student can make, as (method, url, json)."""
    project = f"/projects/{project_id}"
    return [
        ("PATCH", project, {"expected_context_revision": revision, "name": "Renamed"}),
        ("PATCH", project, {"expected_context_revision": revision, "system_prompt": "Give answers."}),
        ("POST", f"{project}/files", {"expected_context_revision": revision, "file_ids": [str(file_id)]}),
        ("DELETE", f"{project}/files", {"expected_context_revision": revision, "file_ids": [str(file_id)]}),
        ("POST", f"{project}/sub-agents", {"expected_context_revision": revision, "agent_ids": [str(agent_id)]}),
        ("DELETE", f"{project}/sub-agents", {"expected_context_revision": revision, "agent_ids": [str(agent_id)]}),
        ("PUT", f"/agents/sub-agents/{agent_id}", sub_agent_payload()),
        (
            "PUT",
            f"/agents/sub-agents/{agent_id}/instructions",
            {"expected_revision": agent_revision, "system_prompt": "Give answers."},
        ),
        ("DELETE", f"/agents/sub-agents/{agent_id}", None),
        ("DELETE", f"/files/{filename}", None),
        ("DELETE", "/files/", [filename]),
    ]


async def send(client, method, url, body, user="s1"):
    return await client.request(method, url, headers=auth(user), json=body)


async def test_every_guarded_write_refuses_course_records(course):
    client = course["client"]
    project, agent, file = await added(course)
    for method, url, body in attempts(
        project.id, project.context_revision, agent.id, agent.config_revision, file.id, file.filename
    ):
        response = await send(client, method, url, body)
        assert response.status_code == 409, (method, url, response.text)
        assert response.json()["reason"] == "course_managed", (method, url)
        assert "Biology 101" in response.json()["detail"]

    # Nothing changed.
    [after], [agent_after], [file_after], links, picks = await student_records(course)
    assert (after.name, after.system_prompt) == (project.name, project.system_prompt)
    assert agent_after.system_prompt == agent.system_prompt and file_after.id == file.id
    assert len(links) == 1 and len(picks) == 1


async def test_a_course_file_in_a_bulk_delete_stops_the_whole_batch(course):
    _, _, file = await added(course)
    _, _, own = await own_records(course)
    response = await send(course["client"], "DELETE", "/files/", [own["filename"], file.filename])
    assert response.status_code == 409 and response.json()["reason"] == "course_managed"
    *_, files, _, _ = await student_records(course)
    assert {item.filename for item in files} == {file.filename, own["filename"]}


async def test_the_students_own_records_stay_editable(course):
    client = course["client"]
    await added(course)
    project, agent, file = await own_records(course)
    url = f"/projects/{project['id']}"

    async def revision():
        return (await client.get(url, headers=auth("s1"))).json()["context_revision"]

    steps = [
        ("PATCH", url, {"name": "Renamed"}),
        ("PATCH", url, {"system_prompt": "Be kind."}),
        ("POST", f"{url}/files", {"file_ids": [file["id"]]}),
        ("DELETE", f"{url}/files", {"file_ids": [file["id"]]}),
        ("POST", f"{url}/sub-agents", {"agent_ids": [agent["id"]]}),
        ("DELETE", f"{url}/sub-agents", {"agent_ids": [agent["id"]]}),
    ]
    for method, target, body in steps:
        response = await send(client, method, target, {"expected_context_revision": await revision(), **body})
        assert response.status_code == 200, (method, target, response.text)
    agent_url = f"/agents/sub-agents/{agent['id']}"
    saved = await send(client, "PUT", agent_url, sub_agent_payload("Helper"))
    assert saved.status_code == 200, saved.text
    revision_now = saved.json()["config_revision"]
    response = await send(
        client, "PUT", f"{agent_url}/instructions", {"expected_revision": revision_now, "system_prompt": "Hi."}
    )
    assert response.status_code == 200, response.text
    assert (await send(client, "DELETE", agent_url, None)).status_code == 200
    assert (await send(client, "DELETE", f"/files/{file['filename']}", None)).status_code == 200


async def test_the_course_update_still_replaces_locked_records(course):
    project, agent, _ = await added(course)
    async with course["sessions"]() as session:
        await session.execute(
            update(AgentProfileModel).where(AgentProfileModel.id == course["tutor"]).values(system_prompt="Hints.")
        )
        await session.execute(
            update(ProjectModel)
            .where(ProjectModel.id == uuid.UUID(course["project"]))
            .values(system_prompt="Be brief.")
        )
        await session.commit()
    await publish(course)
    assert (await apply(course, 2)).status_code == 200
    [after], [agent_after], *_ = await student_records(course)
    assert after.id == project.id and after.system_prompt == "Be brief."
    assert agent_after.id == agent.id and agent_after.system_prompt == "Hints."


async def test_deleting_the_project_leaves_the_course_and_releases_the_lock(course):
    client = course["client"]
    project, agent, file = await added(course)
    response = await client.delete(
        f"/projects/{project.id}?expected_context_revision={project.context_revision}", headers=auth("s1")
    )
    assert response.status_code == 200, response.text
    # The rest of the copy is the student's own now; adding the course again re-links it.
    assert (await send(client, "PUT", f"/agents/sub-agents/{agent.id}", sub_agent_payload())).status_code == 200
    assert (await send(client, "DELETE", f"/files/{file.filename}", None)).status_code == 200


@pytest.mark.parametrize("ending", ["leave", "removed", "class deleted"])
async def test_the_lock_ends_with_class_membership(course, ending):
    client = course["client"]
    project, agent, _ = await added(course)
    class_id = course["class"]["id"]
    if ending == "leave":
        response = await client.delete(f"/classes/joined/{class_id}", headers=auth("s1"))
    elif ending == "removed":
        response = await client.delete(f"/classes/{class_id}/members/s1", headers=auth("teach"))
    else:
        response = await client.delete(f"/classes/{class_id}", headers=auth("teach"))
    assert response.status_code == 204, response.text
    renamed = await send(
        client,
        "PATCH",
        f"/projects/{project.id}",
        {"expected_context_revision": project.context_revision, "name": "My biology"},
    )
    assert renamed.status_code == 200, renamed.text
    assert (await send(client, "PUT", f"/agents/sub-agents/{agent.id}", sub_agent_payload())).status_code == 200


async def test_another_students_copy_does_not_lock_anything_for_this_one(course):
    client = course["client"]
    project, _, _ = await added(course)
    # Same ids, different owner: the owner check answers first and the lock never leaks.
    response = await send(
        client, "PATCH", f"/projects/{project.id}", {"expected_context_revision": 1, "name": "x"}, user="s2"
    )
    assert response.status_code == 404


async def test_reads_mark_course_records_with_their_class(course):
    client = course["client"]
    project, agent, file = await added(course)
    own_project, own_agent, own_file = await own_records(course)

    async def get(url):
        response = await client.get(url, headers=auth("s1"))
        assert response.status_code == 200, response.text
        return response.json()

    assert (await get(f"/projects/{project.id}"))["managed_by_class"] == "Biology 101"
    assert (await get(f"/projects/{own_project['id']}")).get("managed_by_class") is None
    listed = {item["id"]: item["managed_by_class"] for item in (await get("/projects/"))["projects"]}
    assert listed == {str(project.id): "Biology 101", own_project["id"]: None}

    sub_agents = {item["id"]: item["managed_by_class"] for item in (await get("/agents/sub-agents"))["items"]}
    assert sub_agents == {str(agent.id): "Biology 101", own_agent["id"]: None}
    [selected] = (await get(f"/projects/{project.id}/sub-agents"))["agents"]
    assert selected["managed_by_class"] == "Biology 101"

    files = {item["id"]: item["managed_by_class"] for item in (await get("/files/"))["files"]}
    assert files == {str(file.id): "Biology 101", own_file["id"]: None}
    [attached] = (await get(f"/projects/{project.id}/files"))["files"]
    assert attached["managed_by_class"] == "Biology 101"

    # The mark is live: leaving the class clears it.
    assert (await client.delete(f"/classes/joined/{course['class']['id']}", headers=auth("s1"))).status_code == 204
    assert (await get(f"/projects/{project.id}"))["managed_by_class"] is None
