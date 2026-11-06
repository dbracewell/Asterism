"""US-58.3: topic tags, mastery per topic from study results, and topic practice."""

import uuid

import pytest
from asterism.domains.study.mastery import level_for, practice_order
from test_projects_api import auth, create
from test_study_drafts import drafts_api as _drafts_api
from test_study_drafts import project_api as _project_api
from test_study_quizzes import answer_for, option_index, quizzes_path, setup_quiz, submit
from test_study_weak_spots import rate
from test_study_weak_spots import ticking as _ticking

project_api = _project_api
drafts_api = _drafts_api
ticking = _ticking

POWER, MEMBRANE = "Powerhouse of the cell?", "Cell membrane is made of?"


def topics_path(project_id, *rest):
    return "/".join([f"/projects/{project_id}/study/topics", *rest])


async def topics(api, project_id, user="a"):
    response = await api.client.get(topics_path(project_id), headers=auth(user))
    assert response.status_code == 200, response.text
    return {item["label"]: item for item in response.json()["items"]}


async def deck_with_cards(api, project_id, tags, fronts=("A?", "B?"), name="Deck"):
    decks = f"/projects/{project_id}/study/decks"
    deck = await api.client.post(decks, headers=auth(), json={"name": name, "tags": tags})
    assert deck.status_code == 201, deck.text
    deck = deck.json()
    cards = []
    for front in fronts:
        card = await api.client.post(
            f"{decks}/{deck['id']}/cards", headers=auth(), json={"front": front, "back": f"{front} answer"}
        )
        cards.append(card.json())
    return deck, cards


def test_levels_and_practice_order():
    assert level_for(None, 0) == "not_started"
    assert level_for(0.4, 1) == "needs_work"
    assert level_for(0.79, 1) == "developing"
    assert level_for(0.9, 0.5) == "developing"
    assert level_for(0.8, 0.8) == "mastered"
    a, b, c, d = (("card", uuid.UUID(int=n)) for n in range(4))
    history = {a: [(10, 1.0)], b: [(20, 0.6)], d: [(5, 0.0), (30, 0.9)]}
    # Weakest practiced first (b, d), then unpracticed (c), then fully recalled (a).
    assert practice_order([a, b, c, d], history) == [b, d, c, a]


@pytest.mark.asyncio
async def test_tags_are_normalized_and_validated(drafts_api):
    api = drafts_api
    project_id = (await create(api.client, name="Tags"))["id"]
    deck, _ = await deck_with_cards(api, project_id, ["  Cell   biology ", "cell BIOLOGY", "Energy"], fronts=())
    assert deck["tags"] == ["Cell biology", "Energy"]
    decks = f"/projects/{project_id}/study/decks"
    for tags in (["x"] * 9, ["y" * 41], [" "], ["two\nlines"]):
        response = await api.client.post(decks, headers=auth(), json={"name": "Bad", "tags": tags})
        assert response.status_code == 422, tags
    patched = await api.client.patch(f"{decks}/{deck['id']}", headers=auth(), json={"tags": ["Genetics"]})
    assert patched.json()["tags"] == ["Genetics"] and patched.json()["name"] == "Deck"
    assert (await api.client.patch(f"{decks}/{deck['id']}", headers=auth(), json={"tags": None})).status_code == 422

    project_id, _, quiz = await setup_quiz(api)
    assert quiz["tags"] == []
    path = quizzes_path(project_id, quiz["id"])
    retagged = await api.client.patch(path, headers=auth(), json={"tags": ["Cells"]})
    assert retagged.status_code == 200 and retagged.json()["tags"] == ["Cells"]
    assert retagged.json()["title"] == quiz["title"]
    renamed = await api.client.patch(path, headers=auth(), json={"title": "Cells quiz"})
    assert renamed.json()["title"] == "Cells quiz" and renamed.json()["tags"] == ["Cells"]
    assert (await api.client.patch(path, headers=auth(), json={"title": None})).status_code == 422


@pytest.mark.asyncio
async def test_mastery_follows_latest_outcomes_per_topic(drafts_api, ticking):
    api = drafts_api
    project_id, _, quiz = await setup_quiz(api)
    await api.client.patch(quizzes_path(project_id, quiz["id"]), headers=auth(), json={"tags": ["cells"]})
    deck, (first, second) = await deck_with_cards(api, project_id, ["Cells", "Energy"])
    await deck_with_cards(api, project_id, [], fronts=("Untagged?",), name="Loose")

    before = await topics(api, project_id)
    # Tags match case-insensitively; the first spelling seen labels the topic.
    assert list(before) == ["Cells", "Energy"]
    cells = before["Cells"]
    assert cells["key"] == "cells" and cells["level"] == "not_started" and cells["score"] is None
    assert (cells["practiced"], cells["total"], cells["deck_count"], cells["quiz_count"]) == (0, 6, 1, 1)
    assert len(cells["trend"]) == 8 and all(point["score"] is None for point in cells["trend"])

    await rate(api, project_id, deck, first, "good")
    energy = (await topics(api, project_id))["Energy"]
    assert energy["score"] == 0.9 and energy["practiced"] == 1 and energy["level"] == "developing"
    await rate(api, project_id, deck, second, "easy")
    energy = (await topics(api, project_id))["Energy"]
    assert energy["score"] == 0.95 and energy["level"] == "mastered"
    await rate(api, project_id, deck, first, "again")
    energy = (await topics(api, project_id))["Energy"]
    # Only the latest rating counts.
    assert energy["score"] == 0.5 and energy["level"] == "developing"
    assert energy["trend"][-1]["score"] == 0.5

    await submit(
        api,
        project_id,
        quiz["id"],
        [
            answer_for(quiz, POWER, choice=option_index(quiz, POWER, "Mitochondria")),
            answer_for(quiz, MEMBRANE, choice=option_index(quiz, MEMBRANE, "Steel")),
        ],
        model_id=None,
    )
    cells = (await topics(api, project_id))["Cells"]
    # Unanswered short answers in the attempt count as incorrect, like any graded miss.
    assert cells["practiced"] == 6
    assert cells["score"] == round((0.0 + 1.0 + 1.0 + 0.0 + 0.0 + 0.0) / 6, 4)
    assert cells["level"] == "needs_work"


@pytest.mark.asyncio
async def test_topic_practice_copies_weakest_items_and_counts_towards_originals(drafts_api, ticking):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    deck, (strong, weak, fresh) = await deck_with_cards(api, project_id, ["Cells"], fronts=("Strong?", "Weak?", "New?"))
    await rate(api, project_id, deck, strong, "easy")
    await rate(api, project_id, deck, weak, "again")

    response = await api.client.post(
        topics_path(project_id, "practice"), headers=auth(), json={"topic": " CELLS ", "question_count": 2}
    )
    assert response.status_code == 201, response.text
    quiz = response.json()
    assert quiz["origin"] == "topic" and quiz["title"] == "Practice: Cells" and quiz["tags"] == ["Cells"]
    assert quiz["model_name"] is None
    assert [question["prompt"] for question in quiz["questions"]] == ["Weak?", "New?"]
    # The practice quiz's copies are not new items.
    assert (await topics(api, project_id))["Cells"]["total"] == 3

    api.model.replies["Weak? answer"] = '{"verdict": "correct", "explanation": "Yes."}'
    await submit(
        api,
        project_id,
        quiz["id"],
        [{"question_id": quiz["questions"][0]["id"], "text": "Weak? answer"}],
    )
    cells = (await topics(api, project_id))["Cells"]
    assert cells["practiced"] == 3


@pytest.mark.asyncio
async def test_topics_are_owner_and_project_scoped(drafts_api, ticking):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    other = (await create(api.client, name="Other"))["id"]
    await deck_with_cards(api, project_id, ["Cells"], fronts=())
    assert (await topics(api, other)) == {}
    assert (await api.client.get(topics_path(project_id), headers=auth("b"))).status_code == 404
    practice = topics_path(project_id, "practice")
    assert (await api.client.post(practice, headers=auth(), json={"topic": "Unknown"})).status_code == 404
    # A tagged deck without cards gives the topic nothing to practice.
    assert (await api.client.post(practice, headers=auth(), json={"topic": "cells"})).status_code == 400
    assert (await api.client.post(practice, headers=auth("b"), json={"topic": "cells"})).status_code == 404
