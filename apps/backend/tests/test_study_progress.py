"""ADR-0067: the combined progress read, pending unclear items and weak-spot topics."""

import uuid

import pytest
from asterism.domains.reflections.models import ReflectionModel
from asterism.domains.study.unclear import split_unclear
from sqlalchemy import update
from test_projects_api import auth, create
from test_study_drafts import drafts_api as _drafts_api
from test_study_drafts import project_api as _project_api
from test_study_mastery import deck_with_cards
from test_study_unclear import convert, reflection_in
from test_study_weak_spots import practice, progress, rate
from test_study_weak_spots import ticking as _ticking

project_api = _project_api
drafts_api = _drafts_api
ticking = _ticking


def test_split_unclear_removes_markers_blanks_and_repeats():
    assert split_unclear(
        "- Tonicity\n\n* Why cells burst\r\n2. Osmosis vs diffusion\n3) Pumps\n• Gradients\nTonicity"
    ) == [
        "Tonicity",
        "Why cells burst",
        "Osmosis vs diffusion",
        "Pumps",
        "Gradients",
    ]
    # A marker needs a following space; a paragraph stays one item.
    assert split_unclear("One paragraph about - dashes.") == ["One paragraph about - dashes."]
    assert split_unclear("-not a marker\n1.5 litres") == ["-not a marker", "1.5 litres"]
    assert split_unclear("  \n ") == []


async def unclear_texts(api, project_id, user="a"):
    unclear = (await progress(api, project_id, user))["unclear"]
    return unclear["total"], [item["text"] for item in unclear["items"]]


@pytest.mark.asyncio
async def test_pending_items_are_split_and_drop_once_they_are_cards(drafts_api, ticking):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    older = await reflection_in(api, project_id, unclear="- Osmosis\n- Tonicity")
    newer = await reflection_in(api, project_id, unclear="1. Why cells burst\n2. Osmosis")
    # Both may land in the same second; order them explicitly.
    async with api.sessions() as session:
        await session.execute(
            update(ReflectionModel).where(ReflectionModel.id == uuid.UUID(older["id"])).values(created_at=1)
        )
        await session.commit()

    data = await progress(api, project_id)
    first = data["unclear"]["items"][0]
    assert first["reflection_id"] == newer["id"] and first["chat_id"] == newer["chat_id"]
    assert first["reflected_at"] == newer["created_at"]
    # Newest reflection first; the same text in two reflections is two items.
    assert await unclear_texts(api, project_id) == (4, ["Why cells burst", "Osmosis", "Osmosis", "Tonicity"])

    assert (await convert(api, project_id, older, item="Osmosis", front="Osmosis")).status_code == 201
    assert await unclear_texts(api, project_id) == (3, ["Why cells burst", "Osmosis", "Tonicity"])
    # The card keeps its item, so a reworded front still clears it.
    reworded = await convert(api, project_id, newer, item="Why cells burst", front="Why do cells burst?")
    assert reworded.status_code == 201
    assert await unclear_texts(api, project_id) == (2, ["Osmosis", "Tonicity"])


@pytest.mark.asyncio
async def test_pending_items_are_owner_and_project_scoped(drafts_api, ticking):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    other = (await create(api.client, name="Other"))["id"]
    await reflection_in(api, project_id, unclear="Tonicity")
    await reflection_in(api, project_id, unclear="")
    assert await unclear_texts(api, project_id) == (1, ["Tonicity"])
    assert await unclear_texts(api, other) == (0, [])
    assert (await api.client.get(f"/projects/{project_id}/study/progress", headers=auth("b"))).status_code == 404


@pytest.mark.asyncio
async def test_weak_spots_carry_their_original_topics(drafts_api, ticking):
    api = drafts_api
    project_id = (await create(api.client))["id"]
    deck, (card,) = await deck_with_cards(api, project_id, ["Cells", "Energy"], fronts=("ATP?",))
    _, (untagged,) = await deck_with_cards(api, project_id, [], fronts=("Plain?",), name="Plain")
    await rate(api, project_id, deck, card, "again")
    plain_deck = {"id": untagged["deck_id"]}
    await rate(api, project_id, plain_deck, untagged, "again")

    data = await progress(api, project_id)
    assert {topic["key"] for topic in data["topics"]} == {"cells", "energy"}
    assert {spot["prompt"]: spot["topics"] for spot in data["weak_spots"]["items"]} == {
        "ATP?": ["cells", "energy"],
        "Plain?": [],
    }

    # A copy re-asked in a practice quiz keeps counting towards the original's topics.
    quiz = (await practice(api, project_id, topic="energy")).json()
    assert quiz["origin"] == "practice" and quiz["tags"] == ["Energy"]
    await api.client.post(
        f"/projects/{project_id}/study/quizzes/{quiz['id']}/attempts", headers=auth(), json={"answers": []}
    )
    spots = (await progress(api, project_id))["weak_spots"]["items"]
    copy = next(spot for spot in spots if spot["prompt"] == "ATP?")
    assert copy["source_id"] != copy["root_id"] and copy["topics"] == ["cells", "energy"]
