"""US-53.6: depth-controlled summaries, study guides, and saved notes."""

import asyncio
import json
import uuid

import pytest
from asterism.domains.projects.models import ProjectFileModel
from asterism.domains.study import study_guides
from asterism.domains.study.models import StudyNoteModel
from sqlalchemy import delete, func, select
from test_projects_api import auth, create
from test_study_drafts import MODEL, add_file
from test_study_drafts import drafts_api as _drafts_api
from test_study_drafts import project_api as _project_api
from test_study_quizzes import answer_for, option_index, setup_quiz, submit

project_api = _project_api
drafts_api = _drafts_api


def study(project_id, *rest):
    return "/".join([f"/projects/{project_id}/study", *rest])


def sections(*items):
    return json.dumps({"sections": [{"heading": h, "text": t, "sources": s} for h, t, s in items]})


async def summarize(api, project_id, user="a", **body):
    payload = {"model_id": MODEL, "depth": "standard", **body}
    return await api.client.post(study(project_id, "summaries"), headers=auth(user), json=payload)


async def plan(api, project_id, user="a", **body):
    payload = {"model_id": MODEL, "start_date": "2026-11-02", "exam_date": "2026-11-05", **body}
    return await api.client.post(study(project_id, "study-guides"), headers=auth(user), json=payload)


async def note_count(api):
    async with api.sessions() as session:
        return await session.scalar(select(func.count()).select_from(StudyNoteModel))


# --- Summaries -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_summary_sections_cite_chunks_and_are_not_saved(drafts_api):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    cells = await add_file(api, project_id, "cells.txt")
    garbage = await add_file(api, project_id, "garbage.txt")
    api.model.replies = {
        "cells.txt": sections(
            ("Energy", "ATP **stores** energy.", ["S2", "S1", "S2", "S9"]),
            ("Two\nlines", "Text", ["S7"]),
            ("", "No heading", ["S1"]),
        ),
        "garbage.txt": "nope",
    }
    response = await summarize(api, project_id, depth="simple")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    draft = response.json()
    assert draft["title"] == "Simple summary: cells.txt and 1 more"
    assert draft["depth"] == "simple" and draft["model_name"] == "Chat A"
    assert [s["heading"] for s in draft["sections"]] == ["Energy", "Two lines"]
    first = draft["sections"][0]
    # Known labels become chunk citations, deduplicated; unknown labels are dropped.
    assert [c["chunk_id"] for c in first["citations"]] == [f"{cells}-c1", f"{cells}-c0"]
    # A section citing only unknown labels still cites its file.
    assert draft["sections"][1]["citations"] == [
        {
            "file_id": cells,
            "chunk_id": None,
            "artifact_generation": None,
            "excerpt": None,
            "available": True,
            "file_name": "cells.txt",
        }
    ]
    assert draft["body"] == "## cells.txt\n\n### Energy\n\nATP **stores** energy.\n\n### Two lines\n\nText\n"
    assert [(c["file_id"], c["chunk_id"]) for c in draft["citations"]] == [
        (cells, f"{cells}-c1"),
        (cells, f"{cells}-c0"),
        (cells, None),
    ]
    assert [(f["file_name"], f["status"], f["section_count"]) for f in draft["files"]] == [
        ("cells.txt", "used", 2),
        ("garbage.txt", "failed", 0),
    ]
    assert {f["file_id"] for f in draft["files"]} == {cells, garbage}
    assert "beginner" in api.model.prompts[0] or "beginner" in api.model.prompts[1]
    assert await note_count(api) == 0


@pytest.mark.asyncio
async def test_summary_depth_scope_and_model_checks(drafts_api):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    other = (await create(api.client, name="Other"))["id"]
    foreign = await add_file(api, other, "other.txt")
    own = await add_file(api, project_id, "notes.txt")
    api.model.replies = {"notes.txt": sections(("H", "T", ["S1"]))}
    for depth, phrase in (("standard", "revising"), ("expert", "advanced reader")):
        assert (await summarize(api, project_id, depth=depth)).status_code == 200
        assert phrase in api.model.prompts[-1]
    assert (await summarize(api, project_id, depth="deep")).status_code == 422
    assert (await summarize(api, project_id, file_ids=[foreign])).status_code == 400
    assert (await summarize(api, project_id, user="b")).status_code == 404
    assert (await summarize(api, project_id, model_id=str(uuid.uuid4()), file_ids=[own])).status_code == 409
    empty = (await summarize(api, project_id, file_ids=[own], depth="simple")).json()
    assert empty["sections"]  # Sanity: the fake still answers.
    api.model.replies = {"notes.txt": sections()}
    nothing = (await summarize(api, project_id, file_ids=[own])).json()
    assert nothing["sections"] == [] and nothing["body"] == "" and nothing["citations"] == []
    assert nothing["files"][0]["message"] == "The model did not return a usable summary."


# --- Study guides --------------------------------------------------------------


async def setup_material(api):
    """A project with a deck, a quiz with a weak spot, and a foreign project's deck."""
    project_id, _, quiz = await setup_quiz(api)
    deck = (await api.client.post(study(project_id, "decks"), headers=auth(), json={"name": "Bio [deck]"})).json()
    await api.client.post(
        study(project_id, "decks", deck["id"], "cards"), headers=auth(), json={"front": "Q", "back": "A"}
    )
    # Options are shuffled at generation, so choose the wrong answer by text.
    wrong = option_index(quiz, "Powerhouse of the cell?", "Nucleus")
    await submit(api, project_id, quiz["id"], [answer_for(quiz, "Powerhouse of the cell?", choice=wrong)])
    other = (await create(api.client, name="Other"))["id"]
    await api.client.post(study(other, "decks"), headers=auth(), json={"name": "Foreign deck"})
    return project_id, deck, quiz


def guide_reply(*days):
    return json.dumps({"days": list(days)})


@pytest.mark.asyncio
async def test_study_guide_plans_linked_days_within_range(drafts_api):
    api = drafts_api
    project_id, deck, quiz = await setup_material(api)
    api.model.replies = {
        "Plan 4 day(s)": guide_reply(
            {
                "date": "2026-11-03",
                "focus": "Quiz day",
                "tasks": [
                    {"text": "Take the quiz", "minutes": 20, "quiz": "Q1"},
                    {"text": "Unknown deck", "minutes": 999, "deck": "D7"},
                    {"text": "  ", "minutes": 5},
                ],
            },
            {
                "date": "2026-11-02",
                "focus": "Cards",
                "tasks": [{"text": "Review\\nthe deck", "minutes": 30, "deck": "[d1]"}],
            },
            {"date": "2026-11-02", "focus": "Duplicate", "tasks": [{"text": "Ignored"}]},
            {"date": "2026-11-09", "focus": "After the exam", "tasks": [{"text": "Ignored"}]},
            {"date": "tomorrow", "focus": "Bad date", "tasks": [{"text": "Ignored"}]},
        )
    }
    response = await plan(api, project_id, minutes_per_day=45)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    guide = response.json()
    prompt = api.model.prompts[-1]
    assert '[D1] "Bio [deck]" (1 cards, 1 due now)' in prompt
    assert '[Q1] "Quiz: cells.txt" (4 questions, best score 0%)' in prompt
    assert "Weak spots: 4" in prompt and '"cells.txt"' in prompt and "about 45 minutes a day" in prompt
    assert "Foreign deck" not in prompt

    assert guide["title"] == "Study guide for 5 November 2026"
    assert [d["date"] for d in guide["days"]] == ["2026-11-02", "2026-11-03"]
    cards_day, quiz_day = guide["days"]
    assert cards_day["tasks"] == [
        {
            "text": "Review\\nthe deck",
            "minutes": 30,
            "link": {"kind": "deck", "id": deck["id"], "title": "Bio [deck]"},
        }
    ]
    assert quiz_day["tasks"] == [
        {
            "text": "Take the quiz",
            "minutes": 20,
            "link": {"kind": "quiz", "id": quiz["id"], "title": "Quiz: cells.txt"},
        },
        {"text": "Unknown deck", "minutes": None, "link": None},
    ]
    assert guide["body"].startswith(
        "Exam on Thursday 5 November 2026. About 45 minutes a day. Days without an entry are rest days."
    )
    assert f"[Bio \\[deck\\]](/projects/{project_id}/study/{deck['id']})" in guide["body"]
    assert f"[Quiz: cells.txt](/projects/{project_id}/study/quizzes/{quiz['id']})" in guide["body"]
    assert "## Monday 2 November\n\n**Focus:** Cards" in guide["body"]
    assert await note_count(api) == 0


@pytest.mark.asyncio
async def test_study_guide_failures_and_validation(drafts_api, monkeypatch):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    api.model.replies = {"Plan ": "not a plan"}
    response = await plan(api, project_id)
    assert response.status_code == 502 and "could not write a study plan" in response.json()["detail"]
    api.model.replies = {"Plan ": guide_reply({"date": "2027-01-01", "tasks": [{"text": "Out of range"}]})}
    assert (await plan(api, project_id)).status_code == 502
    api.model.replies = {"Plan ": RuntimeError("provider down")}
    assert (await plan(api, project_id)).status_code == 502

    async def slow(_prompt):
        await asyncio.sleep(1)
        return guide_reply()

    api.model.replies = {"Plan ": slow}
    monkeypatch.setattr(study_guides, "MODEL_CALL_SECONDS", 0.05)
    assert (await plan(api, project_id)).status_code == 504

    for body in (
        {"exam_date": "2026-11-01"},
        {"exam_date": "2027-01-01"},
        {"minutes_per_day": 5},
        {"unknown": 1},
    ):
        assert (await plan(api, project_id, **body)).status_code == 422
    one_day = guide_reply({"date": "2026-11-02", "focus": "Everything", "tasks": []})
    api.model.replies = {"Plan 1 day(s)": one_day}
    assert (await plan(api, project_id, exam_date="2026-11-02")).status_code == 200
    assert (await plan(api, project_id, user="b")).status_code == 404
    assert (await plan(api, project_id, model_id=str(uuid.uuid4()))).status_code == 409


# --- Notes ---------------------------------------------------------------------


@pytest.mark.asyncio
async def test_notes_save_drafts_with_checked_citations_and_provenance(drafts_api):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    file_id = await add_file(api, project_id, "cells.txt")
    other = (await create(api.client, name="Other"))["id"]
    foreign = await add_file(api, other, "other.txt")
    citation = {"file_id": file_id, "chunk_id": f"{file_id}-c0", "artifact_generation": 1, "excerpt": "x"}
    body = {"kind": "summary", "title": " Cells ", "body": "## Cells\n\nText", "citations": [citation]}

    created = await api.client.post(study(project_id, "notes"), headers=auth(), json=body | {"model_id": MODEL})
    assert created.status_code == 201, created.text
    note = created.json()
    assert note["title"] == "Cells" and note["model_name"] == "Chat A" and note["model_id"] == MODEL
    assert note["citations"][0]["available"] is True and note["citations"][0]["file_name"] == "cells.txt"

    rejected = [
        body | {"citations": [citation | {"file_id": foreign}]},
        body | {"model_id": str(uuid.uuid4())},
    ]
    for payload in rejected:
        assert (await api.client.post(study(project_id, "notes"), headers=auth(), json=payload)).status_code == 400
    for payload in (body | {"body": "  \n "}, body | {"kind": "essay"}, body | {"title": ""}):
        assert (await api.client.post(study(project_id, "notes"), headers=auth(), json=payload)).status_code == 422

    guide = await api.client.post(
        study(project_id, "notes"), headers=auth(), json={"kind": "study_guide", "title": "Plan", "body": "- Day"}
    )
    assert guide.status_code == 201 and guide.json()["model_name"] is None
    listed = (await api.client.get(study(project_id, "notes"), headers=auth())).json()
    # Same-second updates tie on time, so compare the set; order is newest update first.
    assert listed["total"] == 2 and {item["title"] for item in listed["items"]} == {"Plan", "Cells"}
    assert "body" not in listed["items"][0]

    async with api.sessions() as session:
        await session.execute(delete(ProjectFileModel).where(ProjectFileModel.file_id == uuid.UUID(file_id)))
        await session.commit()
    again = (await api.client.get(study(project_id, "notes", note["id"]), headers=auth())).json()
    assert again["citations"][0]["available"] is False and again["body"] == "## Cells\n\nText"


@pytest.mark.asyncio
async def test_notes_edit_delete_and_isolation(drafts_api):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    other = (await create(api.client, name="Other"))["id"]
    note = (
        await api.client.post(
            study(project_id, "notes"), headers=auth(), json={"kind": "summary", "title": "T", "body": "B"}
        )
    ).json()
    path = study(project_id, "notes", note["id"])
    edited = await api.client.patch(path, headers=auth(), json={"body": "New body"})
    assert edited.status_code == 200 and edited.json()["body"] == "New body" and edited.json()["title"] == "T"
    assert (await api.client.patch(path, headers=auth(), json={"title": None})).status_code == 422
    assert (await api.client.patch(path, headers=auth(), json={"kind": "study_guide"})).status_code == 422

    for user, target in (("b", path), ("a", path.replace(project_id, other))):
        assert (await api.client.get(target, headers=auth(user))).status_code == 404
        assert (await api.client.patch(target, headers=auth(user), json={"title": "X"})).status_code == 404
        assert (await api.client.delete(target, headers=auth(user))).status_code == 404
    assert (await api.client.get(study(project_id, "notes"), headers=auth("b"))).status_code == 404
    assert (await api.client.post(study(project_id, "notes"), headers=auth("b"), json={})).status_code in (404, 422)

    assert (await api.client.delete(path, headers=auth())).status_code == 204
    assert (await api.client.get(path, headers=auth())).status_code == 404

    await api.client.post(
        study(project_id, "notes"), headers=auth(), json={"kind": "summary", "title": "T", "body": "B"}
    )
    revision = (await api.client.get(f"/projects/{project_id}", headers=auth())).json()["context_revision"]
    deleted = await api.client.delete(
        f"/projects/{project_id}", headers=auth(), params={"expected_context_revision": revision}
    )
    assert deleted.status_code == 200
    assert await note_count(api) == 0
