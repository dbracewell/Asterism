"""US-58.4: a reflection's unclear items become confirmed cards and weak-spot practice."""

import uuid

import pytest
from test_chat_models import A
from test_projects_api import auth, create
from test_study_drafts import drafts_api as _drafts_api
from test_study_drafts import project_api as _project_api
from test_study_mastery import topics
from test_study_weak_spots import practice, rate, weak
from test_study_weak_spots import ticking as _ticking

project_api = _project_api
drafts_api = _drafts_api
ticking = _ticking


async def reflection_in(api, project_id, unclear="Why do cells burst?", user="a"):
    chat = await api.client.post(
        "/chat/",
        headers=auth(user),
        json={"request_id": str(uuid.uuid4()), "user_prompt": "Hi", "model_id": A, "project_id": project_id},
    )
    assert chat.status_code == 200, chat.text
    response = await api.client.post(
        "/reflections/",
        headers=auth(user),
        json={"chat_id": chat.json()["info"]["id"], "learned": "Osmosis", "unclear": unclear},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def convert(api, project_id, reflection, user="a", **body):
    payload = {"reflection_id": reflection["id"], "front": "Why do cells burst?", "back": "Water rushes in.", **body}
    return await api.client.post(f"/projects/{project_id}/study/unclear-cards", headers=auth(user), json=payload)


async def decks(api, project_id):
    return (await api.client.get(f"/projects/{project_id}/study/decks", headers=auth())).json()["items"]


@pytest.mark.asyncio
async def test_confirmed_item_becomes_a_due_card_and_a_weak_spot_until_recalled(drafts_api, ticking):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    reflection = await reflection_in(api, project_id)

    response = await convert(api, project_id, reflection)
    assert response.status_code == 201, response.text
    card = response.json()
    assert card["front"] == "Why do cells burst?" and card["back"] == "Water rushes in."
    [deck] = await decks(api, project_id)
    assert deck["name"] == "Unclear items" and deck["card_count"] == 1

    spots = await weak(api, project_id)
    assert [(s["root_id"], s["outcome"], s["kind"]) for s in spots["items"]] == [(card["id"], "unclear", "card")]

    # The flag is not a result: nothing is scheduled or scored from it.
    await api.client.patch(f"/projects/{project_id}/study/decks/{deck['id']}", headers=auth(), json={"tags": ["Cells"]})
    cells = (await topics(api, project_id))["Cells"]
    assert cells["practiced"] == 0 and cells["score"] is None

    quiz = (await practice(api, project_id, question_count=5)).json()
    assert [question["prompt"] for question in quiz["questions"]] == ["Why do cells burst?"]

    await rate(api, project_id, deck, card, "again")
    assert (await weak(api, project_id))["items"][0]["outcome"] == "again"
    await rate(api, project_id, deck, card, "good")
    assert (await weak(api, project_id))["total"] == 0


@pytest.mark.asyncio
async def test_a_review_in_the_same_second_clears_the_flag(drafts_api, monkeypatch):
    from asterism.domains.study import clock

    monkeypatch.setattr(clock, "now_seconds", lambda: 5_000)
    api = drafts_api
    project_id = (await create(api.client))["id"]
    card = (await convert(api, project_id, await reflection_in(api, project_id))).json()
    [deck] = await decks(api, project_id)
    await rate(api, project_id, deck, card, "good")
    assert (await weak(api, project_id))["total"] == 0


@pytest.mark.asyncio
async def test_cards_can_skip_weak_spots_and_go_to_a_chosen_deck(drafts_api, ticking):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    reflection = await reflection_in(api, project_id, "A\nB")
    path = f"/projects/{project_id}/study/decks"
    chosen = (await api.client.post(path, headers=auth(), json={"name": "Biology"})).json()

    response = await convert(api, project_id, reflection, deck_id=chosen["id"], weak_spot=False, front="A")
    assert response.status_code == 201, response.text
    assert (await weak(api, project_id))["total"] == 0
    assert [deck["name"] for deck in await decks(api, project_id)] == ["Biology"]
    # The default deck is reused, not duplicated.
    await convert(api, project_id, reflection, front="B")
    await convert(api, project_id, reflection, front="C")
    names = [deck["name"] for deck in await decks(api, project_id)]
    assert sorted(names) == ["Biology", "Unclear items"]


@pytest.mark.asyncio
async def test_conversion_is_scoped_and_rejects_repeats(drafts_api, ticking):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    other = (await create(api.client, name="Other"))["id"]
    reflection = await reflection_in(api, project_id)
    assert (await convert(api, project_id, reflection)).status_code == 201
    # Confirming the same item twice never makes a second card.
    assert (await convert(api, project_id, reflection)).status_code == 409
    assert (await convert(api, other, reflection, front="New")).status_code == 400
    assert (await convert(api, project_id, reflection, user="b", front="New")).status_code == 404
    assert (await convert(api, project_id, reflection, deck_id=str(uuid.uuid4()), front="New")).status_code == 404
    assert (await convert(api, project_id, reflection, front="  ")).status_code == 422
    assert (await convert(api, project_id, reflection, back="")).status_code == 422
    missing = {"id": str(uuid.uuid4())}
    assert (await convert(api, project_id, missing, front="New")).status_code == 404
    learned_only = await reflection_in(api, project_id, unclear="")
    assert (await convert(api, project_id, learned_only, front="New")).status_code == 400


@pytest.mark.asyncio
async def test_deleting_the_reflection_keeps_the_due_card(drafts_api):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    reflection = await reflection_in(api, project_id)
    assert (await convert(api, project_id, reflection)).status_code == 201
    deleted = await api.client.delete(f"/reflections/{reflection['id']}?expected_revision=1", headers=auth())
    assert deleted.status_code == 204
    [deck] = await decks(api, project_id)
    assert deck["card_count"] == 1 and deck["due_count"] == 1
    assert (await weak(api, project_id))["total"] == 1
