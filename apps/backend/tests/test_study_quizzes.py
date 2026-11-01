"""US-53.4: practice quiz generation, grading paths, citation scope and attempt history."""

import json
import random
import uuid

import pytest
from asterism.domains.projects.models import ProjectFileModel
from asterism.domains.retrieval.sources import SourceChunk, SourceExcerpt
from asterism.domains.settings.models import LLMModel
from asterism.domains.study import clock, quiz_generation
from asterism.domains.study.drafting import DraftFailed
from asterism.domains.study.models import (
    StudyQuizAnswerModel,
    StudyQuizAttemptModel,
    StudyQuizModel,
    StudyQuizQuestionModel,
)
from sqlalchemy import delete, func, select, update
from test_projects_api import auth, create
from test_study_drafts import MODEL, add_file
from test_study_drafts import drafts_api as _drafts_api
from test_study_drafts import project_api as _project_api

project_api = _project_api
drafts_api = _drafts_api


def mc(prompt, options, answer, source="S1", explanation="Because the notes say so."):
    return {
        "type": "multiple_choice",
        "prompt": prompt,
        "options": options,
        "answer": answer,
        "explanation": explanation,
        "source": source,
    }


def sa(prompt, rubric, source="S1"):
    return {"type": "short_answer", "prompt": prompt, "rubric": rubric, "source": source}


def questions(*items):
    return json.dumps({"questions": list(items)})


def grade(verdict, explanation="Feedback."):
    return json.dumps({"verdict": verdict, "explanation": explanation})


def quizzes_path(project_id, *rest):
    return "/".join([f"/projects/{project_id}/study/quizzes", *rest])


async def generate(api, project_id, user="a", **body):
    payload = {"model_id": MODEL, "question_count": 4, "kinds": ["multiple_choice", "short_answer"], **body}
    return await api.client.post(quizzes_path(project_id), headers=auth(user), json=payload)


async def setup_quiz(api):
    """A saved quiz from one file: two multiple-choice and two short-answer questions."""
    project = await create(api.client)
    project_id = project["id"]
    file_id = await add_file(api, project_id, "cells.txt")
    api.model.replies["cells.txt chunk one"] = questions(
        mc("Powerhouse of the cell?", ["Nucleus", "Mitochondria", "Ribosome"], 1, source="S2"),
        mc("Cell membrane is made of?", ["Lipids", "Steel"], "A"),
        sa("What does ATP do?", "Stores and transfers energy."),
        sa("Name the genetic material.", "DNA."),
    )
    response = await generate(api, project_id, file_ids=[file_id])
    assert response.status_code == 200, response.text
    quiz = response.json()["quiz"]
    return project_id, file_id, quiz


def answer_for(quiz, prompt, **answer):
    question = next(q for q in quiz["questions"] if q["prompt"] == prompt)
    return {"question_id": question["id"], **answer}


def option_index(quiz, prompt, option):
    return next(q for q in quiz["questions"] if q["prompt"] == prompt)["options"].index(option)


async def submit(api, project_id, quiz_id, answers, user="a", model_id=MODEL):
    body = {"answers": answers} | ({"model_id": model_id} if model_id else {})
    return await api.client.post(quizzes_path(project_id, quiz_id, "attempts"), headers=auth(user), json=body)


# --- Generation --------------------------------------------------------------


@pytest.mark.asyncio
async def test_generated_quiz_is_saved_without_its_answer_key(drafts_api):
    api = drafts_api
    project_id, file_id, quiz = await setup_quiz(api)
    assert quiz["title"] == "Quiz: cells.txt"
    assert quiz["question_count"] == 4
    assert (quiz["multiple_choice_count"], quiz["short_answer_count"]) == (2, 2)
    assert quiz["attempt_count"] == 0 and quiz["last_score"] is None
    assert quiz["model_name"] == "Chat A"
    assert [q["kind"] for q in quiz["questions"]] == ["multiple_choice"] * 2 + ["short_answer"] * 2
    # Taking the quiz never exposes the answer key or the sources.
    for question in quiz["questions"]:
        assert set(question) == {"id", "position", "kind", "prompt", "options"}
    assert sorted(quiz["questions"][0]["options"]) == ["Mitochondria", "Nucleus", "Ribosome"]
    assert quiz["questions"][2]["options"] == []

    fetched = await api.client.get(quizzes_path(project_id, quiz["id"]), headers=auth())
    assert fetched.status_code == 200
    assert fetched.json()["questions"] == quiz["questions"]

    async with api.sessions() as session:
        rows = list(await session.scalars(select(StudyQuizQuestionModel).order_by(StudyQuizQuestionModel.position)))
    first = rows[0]
    assert json.loads(first.options)[first.correct_option] == "Mitochondria"
    assert json.loads(rows[1].options)[rows[1].correct_option] == "Lipids"  # Letter answers are accepted.
    assert rows[2].rubric == "Stores and transfers energy." and rows[2].correct_option is None
    citation = json.loads(first.citations)[0]
    assert citation["file_id"] == file_id and citation["chunk_id"] == f"{file_id}-c1"


@pytest.mark.asyncio
async def test_generation_spreads_questions_and_reports_failed_files(drafts_api):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    good = await add_file(api, project_id, "good.txt")
    garbage = await add_file(api, project_id, "garbage.txt")
    api.model.replies = {
        "good.txt": questions(sa("Q1", "R1"), sa("Q2", "R2"), sa("Q3", "R3")),
        "garbage.txt": "not json",
    }
    response = await generate(api, project_id, question_count=3, kinds=["short_answer"])
    body = response.json()
    # Whole-project scope runs in file-name order: garbage.txt gets 2, good.txt 1.
    assert [(f["file_name"], f["status"], f["question_count"]) for f in body["files"]] == [
        ("garbage.txt", "failed", 0),
        ("good.txt", "used", 1),
    ]
    assert body["files"][0]["message"] == "The model returned an unreadable reply."
    assert [q["prompt"] for q in body["quiz"]["questions"]] == ["Q1"]
    assert {good, garbage} == {f["file_id"] for f in body["files"]}
    assert "short-answer questions" in api.model.prompts[0]


@pytest.mark.asyncio
async def test_no_usable_question_saves_nothing(drafts_api):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    await add_file(api, project_id, "notes.txt")
    api.model.replies = {
        "notes.txt": questions(
            mc("One option", ["Only"], 0),
            mc("Out of range", ["A", "B"], 5),
            mc("Duplicate options", ["Same", "same"], 0),
            sa("No rubric", ""),
            {"type": "essay", "prompt": "Unknown kind"},
        )
    }
    body = (await generate(api, project_id)).json()
    assert body["quiz"] is None
    assert body["files"][0]["message"] == "The model did not return any usable questions."
    async with api.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(StudyQuizModel)) == 0


def test_parse_filters_kinds_and_shuffles_the_correct_option():
    excerpt = SourceExcerpt(uuid.uuid4(), (SourceChunk(uuid.uuid4(), 1, "c0", 0, "text"),), truncated=False)
    raw = questions(sa("Short", "Rubric"), mc("Pick", ["Right", "W1", "W2", "W3"], 0, source="S7"))
    parsed = quiz_generation.parse_questions(raw, excerpt, 5, ["multiple_choice"], "f.txt", random.Random(3))
    assert len(parsed) == 1
    question = parsed[0]
    assert question.options[question.correct_option] == "Right"
    # An unknown source label falls back to a file-only citation.
    assert question.citations[0].chunk_id is None and question.citations[0].file_id == excerpt.file_id
    positions = {
        quiz_generation.parse_questions(raw, excerpt, 5, ["multiple_choice"], None, random.Random(seed))[
            0
        ].correct_option
        for seed in range(20)
    }
    assert len(positions) > 1
    with pytest.raises(DraftFailed):
        quiz_generation.parse_questions('{"questions": "nope"}', excerpt, 5, ["short_answer"], None)


@pytest.mark.asyncio
async def test_file_removed_from_the_project_during_generation_is_not_cited(drafts_api, monkeypatch):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    kept = await add_file(api, project_id, "kept.txt")
    removed = await add_file(api, project_id, "removed.txt")

    async def remove_then_reply(_prompt):
        async with api.sessions() as session:
            await session.execute(delete(ProjectFileModel).where(ProjectFileModel.file_id == uuid.UUID(removed)))
            await session.commit()
        return questions(sa("From removed", "R"))

    api.model.replies = {"kept.txt": questions(sa("From kept", "R")), "removed.txt": remove_then_reply}
    monkeypatch.setattr(quiz_generation, "MAX_CONCURRENT_CALLS", 1)
    body = (await generate(api, project_id, question_count=2, file_ids=[kept, removed])).json()
    assert [q["prompt"] for q in body["quiz"]["questions"]] == ["From kept"]
    assert body["files"][1]["message"] == quiz_generation.LEFT_SCOPE_MESSAGE


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {"question_count": 0},
        {"question_count": 21},
        {"kinds": []},
        {"kinds": ["essay"]},
        {"kinds": ["short_answer", "short_answer"]},
        {"title": " "},
        {"file_ids": []},
        {"unknown": 1},
    ],
)
async def test_generate_validation(drafts_api, body):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    assert (await generate(api, project_id, **body)).status_code == 422


@pytest.mark.asyncio
async def test_generation_scope_and_model_checks(drafts_api):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    other_project = (await create(api.client, name="Other"))["id"]
    foreign = await add_file(api, other_project, "other.txt")
    assert (await generate(api, project_id)).status_code == 400  # No files in the project.
    assert (await generate(api, project_id, file_ids=[foreign])).status_code == 400
    assert (await generate(api, project_id, user="b")).status_code == 404
    own = await add_file(api, project_id, "notes.txt")
    async with api.sessions() as session:
        await session.execute(update(LLMModel).where(LLMModel.id == uuid.UUID(int=1)).values(is_active=False))
        await session.commit()
    assert (await generate(api, project_id, file_ids=[own])).status_code == 409
    assert api.model.prompts == []


# --- Grading -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_grading_paths_score_and_results(drafts_api):
    api = drafts_api
    project_id, file_id, quiz = await setup_quiz(api)
    api.model.replies["learner says energy"] = grade("correct", "Right: ATP carries energy.")
    api.model.replies["learner says RNA"] = grade("partial", "Close, but it is DNA.")
    answers = [
        answer_for(
            quiz, "Powerhouse of the cell?", choice=option_index(quiz, "Powerhouse of the cell?", "Mitochondria")
        ),
        answer_for(quiz, "Cell membrane is made of?", choice=option_index(quiz, "Cell membrane is made of?", "Steel")),
        answer_for(quiz, "What does ATP do?", text="  learner says energy "),
        answer_for(quiz, "Name the genetic material.", text="learner says RNA"),
    ]
    prompts_before = len(api.model.prompts)
    response = await submit(api, project_id, quiz["id"], answers)
    assert response.status_code == 201, response.text
    attempt = response.json()
    assert attempt["score"] == 2.5 and attempt["question_count"] == 4 and attempt["ungraded_count"] == 0
    assert attempt["grader_model_name"] == "Chat A" and attempt["quiz_title"] == "Quiz: cells.txt"
    results = attempt["results"]
    assert [(r["verdict"], r["grader"]) for r in results] == [
        ("correct", "exact"),
        ("incorrect", "exact"),
        ("correct", "model"),
        ("partial", "model"),
    ]
    assert results[0]["options"][results[0]["correct_option"]] == "Mitochondria"
    assert results[0]["explanation"] == "Because the notes say so."
    assert results[2]["text"] == "learner says energy"
    assert results[2]["feedback"] == "Right: ATP carries energy."
    assert results[3]["rubric"] == "DNA."
    assert results[0]["citations"] == [
        {
            "file_id": file_id,
            "chunk_id": f"{file_id}-c1",
            "artifact_generation": 1,
            "excerpt": "cells.txt chunk two",
            "available": True,
            "file_name": "cells.txt",
        }
    ]
    # Only the two short answers reached the model, inside the answer tags.
    grading = api.model.prompts[prompts_before:]
    assert len(grading) == 2
    assert all("<rubric>" in prompt and "<learner_answer>" in prompt for prompt in grading)


@pytest.mark.asyncio
async def test_blank_and_missing_answers_are_incorrect_without_a_model(drafts_api):
    api = drafts_api
    project_id, _, quiz = await setup_quiz(api)
    prompts_before = len(api.model.prompts)
    answers = [answer_for(quiz, "What does ATP do?", text="   ")]
    response = await submit(api, project_id, quiz["id"], answers, model_id=None)
    assert response.status_code == 201, response.text
    attempt = response.json()
    assert attempt["score"] == 0 and attempt["grader_model_id"] is None
    assert {(r["verdict"], r["grader"], r["feedback"]) for r in attempt["results"]} == {
        ("incorrect", "none", "No answer given.")
    }
    assert len(api.model.prompts) == prompts_before


@pytest.mark.asyncio
async def test_grading_failures_leave_only_that_answer_ungraded(drafts_api):
    api = drafts_api
    project_id, _, quiz = await setup_quiz(api)
    api.model.replies["breaks the model"] = RuntimeError("provider down")
    api.model.replies["confuses the model"] = '{"verdict": "maybe"}'
    answers = [
        answer_for(quiz, "What does ATP do?", text="breaks the model"),
        answer_for(quiz, "Name the genetic material.", text="confuses the model"),
        answer_for(quiz, "Cell membrane is made of?", choice=option_index(quiz, "Cell membrane is made of?", "Lipids")),
    ]
    attempt = (await submit(api, project_id, quiz["id"], answers)).json()
    assert attempt["score"] == 1 and attempt["ungraded_count"] == 2
    ungraded = [r for r in attempt["results"] if r["verdict"] == "ungraded"]
    assert len(ungraded) == 2 and all(r["grader"] == "model" for r in ungraded)


@pytest.mark.asyncio
async def test_slow_grading_hits_the_deadline_and_is_ungraded(drafts_api, monkeypatch):
    import asyncio

    from asterism.domains.study import attempts

    api = drafts_api
    project_id, _, quiz = await setup_quiz(api)

    async def slow(_prompt):
        await asyncio.sleep(1)
        return grade("correct")

    api.model.replies["slow answer"] = slow
    monkeypatch.setattr(attempts, "MODEL_CALL_SECONDS", 0.05)
    attempt = (
        await submit(api, project_id, quiz["id"], [answer_for(quiz, "What does ATP do?", text="slow answer")])
    ).json()
    assert attempt["ungraded_count"] == 1


@pytest.mark.asyncio
async def test_submission_validation(drafts_api):
    api = drafts_api
    project_id, _, quiz = await setup_quiz(api)
    mc_q, sa_q = "Powerhouse of the cell?", "What does ATP do?"
    cases = [
        ([{"question_id": str(uuid.uuid4()), "choice": 0}], MODEL, 400),
        ([answer_for(quiz, mc_q, choice=3)], MODEL, 400),
        ([answer_for(quiz, mc_q, text="Mitochondria")], MODEL, 400),
        ([answer_for(quiz, sa_q, choice=0)], MODEL, 400),
        ([answer_for(quiz, sa_q, text="energy")], None, 400),
        ([answer_for(quiz, sa_q, text="energy")], str(uuid.uuid4()), 409),
        ([answer_for(quiz, mc_q, choice=0), answer_for(quiz, mc_q, choice=1)], MODEL, 422),
        ([answer_for(quiz, sa_q, text="x" * 2_001)], MODEL, 422),
    ]
    for answers, model_id, status in cases:
        response = await submit(api, project_id, quiz["id"], answers, model_id=model_id)
        assert response.status_code == status, (answers, response.text)
    async with api.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(StudyQuizAttemptModel)) == 0


# --- History, scope and isolation --------------------------------------------


@pytest.mark.asyncio
async def test_attempt_history_and_quiz_scores(drafts_api, monkeypatch):
    api = drafts_api
    project_id, _, quiz = await setup_quiz(api)
    q = "Powerhouse of the cell?"
    times = iter([1_000, 2_000])
    monkeypatch.setattr(clock, "now_seconds", lambda: next(times))
    first = (
        await submit(api, project_id, quiz["id"], [answer_for(quiz, q, choice=option_index(quiz, q, "Mitochondria"))])
    ).json()
    second = (
        await submit(api, project_id, quiz["id"], [answer_for(quiz, q, choice=option_index(quiz, q, "Nucleus"))])
    ).json()

    history = (await api.client.get(quizzes_path(project_id, quiz["id"], "attempts"), headers=auth())).json()
    assert [item["id"] for item in history["items"]] == [second["id"], first["id"]]
    assert history["total"] == 2
    again = await api.client.get(quizzes_path(project_id, quiz["id"], "attempts", first["id"]), headers=auth())
    assert again.json() == first

    listed = (await api.client.get(quizzes_path(project_id), headers=auth())).json()["items"][0]
    assert listed["attempt_count"] == 2
    assert listed["best_score"] == 0.25 and listed["last_score"] == 0


@pytest.mark.asyncio
async def test_result_citations_follow_live_project_scope(drafts_api):
    api = drafts_api
    project_id, file_id, quiz = await setup_quiz(api)
    q = "Powerhouse of the cell?"
    attempt = (await submit(api, project_id, quiz["id"], [answer_for(quiz, q, choice=0)])).json()
    async with api.sessions() as session:
        await session.execute(delete(ProjectFileModel).where(ProjectFileModel.file_id == uuid.UUID(file_id)))
        await session.commit()
    again = (
        await api.client.get(quizzes_path(project_id, quiz["id"], "attempts", attempt["id"]), headers=auth())
    ).json()
    citation = again["results"][0]["citations"][0]
    assert citation["available"] is False and citation["file_name"] is None


@pytest.mark.asyncio
async def test_foreign_and_mismatched_quizzes_are_not_found(drafts_api):
    api = drafts_api
    project_id, _, quiz = await setup_quiz(api)
    q = "Powerhouse of the cell?"
    attempt = (await submit(api, project_id, quiz["id"], [answer_for(quiz, q, choice=0)])).json()
    other_project = (await create(api.client, name="Other"))["id"]
    paths = [
        quizzes_path(project_id, quiz["id"]),
        quizzes_path(project_id, quiz["id"], "attempts"),
        quizzes_path(project_id, quiz["id"], "attempts", attempt["id"]),
    ]
    for path in paths:
        assert (await api.client.get(path, headers=auth("b"))).status_code == 404
        moved = path.replace(project_id, other_project)
        assert (await api.client.get(moved, headers=auth())).status_code == 404
    assert (await api.client.get(quizzes_path(project_id), headers=auth("b"))).status_code == 404
    assert (await submit(api, project_id, quiz["id"], [], user="b")).status_code == 404
    missing = quizzes_path(project_id, quiz["id"], "attempts", str(uuid.uuid4()))
    assert (await api.client.get(missing, headers=auth())).status_code == 404
    for method in ("patch", "delete"):
        kwargs = {"json": {"title": "Mine"}} if method == "patch" else {}
        response = await getattr(api.client, method)(quizzes_path(project_id, quiz["id"]), headers=auth("b"), **kwargs)
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_rename_and_delete_cascade(drafts_api):
    api = drafts_api
    project_id, _, quiz = await setup_quiz(api)
    renamed = await api.client.patch(quizzes_path(project_id, quiz["id"]), headers=auth(), json={"title": " Cells "})
    assert renamed.status_code == 200 and renamed.json()["title"] == "Cells"
    q = "Powerhouse of the cell?"
    await submit(api, project_id, quiz["id"], [answer_for(quiz, q, choice=0)])
    assert (await api.client.delete(quizzes_path(project_id, quiz["id"]), headers=auth())).status_code == 204
    assert (await api.client.get(quizzes_path(project_id, quiz["id"]), headers=auth())).status_code == 404
    async with api.sessions() as session:
        for model in (StudyQuizModel, StudyQuizQuestionModel, StudyQuizAttemptModel, StudyQuizAnswerModel):
            assert await session.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.asyncio
async def test_project_deletion_deletes_quizzes(drafts_api):
    api = drafts_api
    project_id, _, quiz = await setup_quiz(api)
    q = "Powerhouse of the cell?"
    await submit(api, project_id, quiz["id"], [answer_for(quiz, q, choice=0)])
    revision = (await api.client.get(f"/projects/{project_id}", headers=auth())).json()["context_revision"]
    response = await api.client.delete(
        f"/projects/{project_id}", headers=auth(), params={"expected_context_revision": revision}
    )
    assert response.status_code == 200, response.text
    async with api.sessions() as session:
        for model in (StudyQuizModel, StudyQuizQuestionModel, StudyQuizAttemptModel, StudyQuizAnswerModel):
            assert await session.scalar(select(func.count()).select_from(model)) == 0
