"""US-53.5: weak spots derived from attempts and review logs, and weak-spot practice."""

import json
import uuid

import pytest
from asterism.domains.projects.models import ProjectFileModel
from asterism.domains.study import clock
from asterism.domains.study.models import StudyQuizQuestionModel
from sqlalchemy import delete, select
from test_projects_api import auth, create
from test_study_drafts import MODEL
from test_study_drafts import drafts_api as _drafts_api
from test_study_drafts import project_api as _project_api
from test_study_quizzes import answer_for, grade, option_index, quizzes_path, setup_quiz, submit

project_api = _project_api
drafts_api = _drafts_api

POWER, MEMBRANE, ATP, DNA = (
    "Powerhouse of the cell?",
    "Cell membrane is made of?",
    "What does ATP do?",
    "Name the genetic material.",
)


@pytest.fixture
def ticking(monkeypatch):
    """A study clock that moves 10 seconds per reading, so outcomes have a strict order."""
    now = iter(range(1_000, 1_000_000, 10))
    monkeypatch.setattr(clock, "now_seconds", lambda: next(now))


def weak_path(project_id, *rest):
    return "/".join([f"/projects/{project_id}/study/weak-spots", *rest])


async def weak(api, project_id, user="a", **params):
    response = await api.client.get(weak_path(project_id), headers=auth(user), params=params)
    assert response.status_code == 200, response.text
    return response.json()


async def practice(api, project_id, user="a", **body):
    return await api.client.post(weak_path(project_id, "practice"), headers=auth(user), json=body)


def choose(quiz, prompt, option):
    return answer_for(quiz, prompt, choice=option_index(quiz, prompt, option))


async def add_card(api, project_id, front="What is ATP?", back="Energy currency", citations=()):
    decks = f"/projects/{project_id}/study/decks"
    deck = (await api.client.post(decks, headers=auth(), json={"name": "Deck"})).json()
    card = await api.client.post(
        f"{decks}/{deck['id']}/cards",
        headers=auth(),
        json={"front": front, "back": back, "citations": list(citations)},
    )
    assert card.status_code == 201, card.text
    return deck, card.json()


async def rate(api, project_id, deck, card, rating):
    path = f"/projects/{project_id}/study/decks/{deck['id']}/cards/{card['id']}"
    reps = (await api.client.get(path, headers=auth())).json()["reps"]
    response = await api.client.post(f"{path}/reviews", headers=auth(), json={"rating": rating, "expected_reps": reps})
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_misses_are_weak_until_a_later_success(drafts_api, ticking):
    api = drafts_api
    project_id, file_id, quiz = await setup_quiz(api)
    api.model.replies["vague energy"] = grade("partial")
    api.model.replies["breaks grading"] = RuntimeError("down")
    await submit(
        api,
        project_id,
        quiz["id"],
        [
            choose(quiz, POWER, "Nucleus"),
            choose(quiz, MEMBRANE, "Lipids"),
            answer_for(quiz, ATP, text="vague energy"),
            answer_for(quiz, DNA, text="breaks grading"),
        ],
    )
    spots = await weak(api, project_id)
    # Ungraded (DNA) says nothing; the correct answer is not weak.
    assert spots["total"] == 2
    assert [(s["prompt"], s["outcome"], s["kind"]) for s in spots["items"]] == [
        (POWER, "incorrect", "multiple_choice"),
        (ATP, "partial", "short_answer"),
    ]
    first = spots["items"][0]
    assert first["root_kind"] == first["source_kind"] == "question"
    assert first["root_id"] == first["source_id"]
    assert first["container_id"] == quiz["id"] and first["container_title"] == "Quiz: cells.txt"
    assert first["citations"][0]["file_id"] == file_id and first["citations"][0]["available"] is True

    await submit(api, project_id, quiz["id"], [choose(quiz, POWER, "Mitochondria")])
    spots = await weak(api, project_id)
    # The newer attempt clears Powerhouse and, unanswered, misses the other three.
    assert {s["prompt"]: s["outcome"] for s in spots["items"]} == {
        MEMBRANE: "incorrect",
        ATP: "incorrect",
        DNA: "incorrect",
    }


@pytest.mark.asyncio
async def test_cards_rated_again_are_weak_until_recalled(drafts_api, ticking):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    deck, card = await add_card(api, project_id)
    await rate(api, project_id, deck, card, "good")
    assert (await weak(api, project_id))["total"] == 0
    await rate(api, project_id, deck, card, "again")
    spots = await weak(api, project_id)
    assert spots["items"] == [
        {
            "root_kind": "card",
            "root_id": card["id"],
            "source_kind": "card",
            "source_id": card["id"],
            "kind": "card",
            "prompt": "What is ATP?",
            "outcome": "again",
            "missed_at": spots["items"][0]["missed_at"],
            "container_id": deck["id"],
            "container_title": "Deck",
            "citations": [],
        }
    ]
    await rate(api, project_id, deck, card, "hard")
    assert (await weak(api, project_id))["total"] == 0


@pytest.mark.asyncio
async def test_practice_copies_weak_items_and_success_clears_the_originals(drafts_api, ticking):
    api = drafts_api
    project_id, _, quiz = await setup_quiz(api)
    deck, card = await add_card(api, project_id, front="What is ATP?", back="Energy currency")
    await submit(api, project_id, quiz["id"], [choose(quiz, POWER, "Ribosome"), choose(quiz, MEMBRANE, "Lipids")])
    await rate(api, project_id, deck, card, "again")
    # Weak: the card (newest), then the two unanswered short answers and Powerhouse.
    assert (await weak(api, project_id))["total"] == 4

    response = await practice(api, project_id, question_count=2)
    assert response.status_code == 201, response.text
    drill = response.json()
    assert drill["origin"] == "weak_spots" and drill["model_name"] is None and drill["model_id"] is None
    assert drill["title"] == "Weak spots practice"
    assert [(q["kind"], q["prompt"]) for q in drill["questions"]][0] == ("short_answer", "What is ATP?")
    assert len(drill["questions"]) == 2
    async with api.sessions() as session:
        copies = list(
            await session.scalars(
                select(StudyQuizQuestionModel)
                .where(StudyQuizQuestionModel.quiz_id == uuid.UUID(drill["id"]))
                .order_by(StudyQuizQuestionModel.position)
            )
        )
    assert copies[0].source_card_id == uuid.UUID(card["id"]) and copies[0].rubric == "Energy currency"
    assert copies[1].source_question_id is not None and copies[1].source_card_id is None

    full = (await practice(api, project_id)).json()
    assert len(full["questions"]) == 4
    api.model.replies["currency of energy"] = grade("correct")
    await submit(
        api,
        project_id,
        full["id"],
        [
            answer_for(full, "What is ATP?", text="currency of energy"),
            choose(full, POWER, "Mitochondria"),
        ],
        model_id=MODEL,
    )
    spots = await weak(api, project_id)
    # The card and Powerhouse are cleared through their copies; the two short answers,
    # unanswered again in the copy, stay weak and now point at the copy as their source.
    assert {s["prompt"] for s in spots["items"]} == {ATP, DNA}
    assert all(s["source_id"] != s["root_id"] and s["container_id"] == full["id"] for s in spots["items"])

    # Practising a copy again still counts towards the original question.
    again = (await practice(api, project_id)).json()
    async with api.sessions() as session:
        roots = set(
            await session.scalars(
                select(StudyQuizQuestionModel.source_question_id).where(
                    StudyQuizQuestionModel.quiz_id == uuid.UUID(again["id"])
                )
            )
        )
    assert roots == {uuid.UUID(s["root_id"]) for s in spots["items"]}


@pytest.mark.asyncio
async def test_practice_keeps_the_answer_key_and_live_citations(drafts_api, ticking):
    api = drafts_api
    project_id, file_id, quiz = await setup_quiz(api)
    await submit(api, project_id, quiz["id"], [choose(quiz, POWER, "Nucleus")])
    async with api.sessions() as session:
        await session.execute(delete(ProjectFileModel).where(ProjectFileModel.file_id == uuid.UUID(file_id)))
        await session.commit()
    drill = (await practice(api, project_id, question_count=1)).json()
    copy = drill["questions"][0]
    assert copy["prompt"] == POWER and sorted(copy["options"]) == ["Mitochondria", "Nucleus", "Ribosome"]
    async with api.sessions() as session:
        row = await session.get(StudyQuizQuestionModel, uuid.UUID(copy["id"]))
    assert row is not None
    assert json.loads(row.options)[row.correct_option] == "Mitochondria"
    assert row.explanation == "Because the notes say so."
    # The cited file left the project, so the copy does not cite it.
    assert json.loads(row.citations) == []


@pytest.mark.asyncio
async def test_weak_spots_are_owner_and_project_scoped(drafts_api, ticking):
    api = drafts_api
    project_id, _, quiz = await setup_quiz(api)
    await submit(api, project_id, quiz["id"], [choose(quiz, POWER, "Nucleus")])
    other = (await create(api.client, name="Other"))["id"]
    assert (await weak(api, other))["total"] == 0
    response = await practice(api, other)
    assert response.status_code == 400 and response.json()["detail"] == "There are no weak spots to practice yet"
    for path in (weak_path(project_id), weak_path(project_id, "practice")):
        method = api.client.get if path.endswith("weak-spots") else api.client.post
        kwargs = {} if path.endswith("weak-spots") else {"json": {}}
        assert (await method(path, headers=auth("b"), **kwargs)).status_code == 404
    assert (await api.client.get(weak_path(str(uuid.uuid4())), headers=auth())).status_code == 404


@pytest.mark.asyncio
async def test_limits_and_validation(drafts_api, ticking):
    api = drafts_api
    project_id, _, quiz = await setup_quiz(api)
    await submit(api, project_id, quiz["id"], [])
    spots = await weak(api, project_id, limit=1)
    assert spots["total"] == 4 and len(spots["items"]) == 1
    for params in ({"limit": 0}, {"limit": 51}):
        assert (await api.client.get(weak_path(project_id), headers=auth(), params=params)).status_code == 422
    for body in ({"question_count": 0}, {"question_count": 21}, {"unknown": 1}):
        assert (await practice(api, project_id, **body)).status_code == 422
    assert len((await practice(api, project_id)).json()["questions"]) == 4
    deleted = await api.client.delete(quizzes_path(project_id, quiz["id"]), headers=auth())
    assert deleted.status_code == 204
    # Answers to the deleted quiz are gone; its practice copy was never answered.
    assert (await weak(api, project_id))["total"] == 0
