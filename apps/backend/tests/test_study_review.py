"""US-53.3: FSRS scheduling math, due queues, ratings and review logs."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from asterism.domains.study import clock
from asterism.domains.study.models import StudyCardModel, StudyReviewLogModel
from asterism.domains.study.scheduling import CardState, FsrsScheduler, Rating, ScheduleState
from sqlalchemy import func, select, update
from test_projects_api import auth, create
from test_projects_api import project_api as _project_api

project_api = _project_api
DAY = 86_400

# Reference vectors produced by the open-spaced-repetition ``fsrs`` package
# (FSRS-6 defaults, fuzzing off): [state, step, stability, difficulty, seconds until due].
REFERENCE = {
    "new_again": ([(0, "AGAIN")], [["learning", 0, 0.212, 6.4133, 60]]),
    "new_hard": ([(0, "HARD")], [["learning", 0, 1.2931, 5.112171, 330]]),
    "new_good": ([(0, "GOOD")], [["learning", 1, 2.3065, 2.118104, 600]]),
    "new_easy": ([(0, "EASY")], [["review", None, 8.2956, 1.0, 691200]]),
    "learn_graduate": (
        [(0, "GOOD"), (600, "GOOD")],
        [["learning", 1, 2.3065, 2.118104, 600], ["review", None, 2.3065, 2.111214, 172800]],
    ),
    "review_cycle": (
        [
            (0, "EASY"),
            (8 * DAY, "GOOD"),
            (30 * DAY, "HARD"),
            (60 * DAY, "AGAIN"),
            (60 * DAY + 600, "GOOD"),
            (70 * DAY, "EASY"),
        ],
        [
            ["review", None, 8.2956, 1.0, 691200],
            ["review", None, 38.90515, 1.0, 3369600],
            ["review", None, 83.326593, 4.010609, 7171200],
            ["relearning", 0, 3.243392, 8.016556, 600],
            ["review", None, 3.243392, 8.003768, 259200],
            ["review", None, 18.53344, 7.321949, 1641600],
        ],
    ),
    "overdue": (
        [(0, "GOOD"), (600, "GOOD"), (100 * DAY, "GOOD")],
        [
            ["learning", 1, 2.3065, 2.118104, 600],
            ["review", None, 2.3065, 2.111214, 172800],
            ["review", None, 50.985218, 2.104331, 4406400],
        ],
    ),
}
T0 = datetime(2030, 1, 1, 12, tzinfo=UTC)  # After any real creation time.


@pytest.mark.parametrize("name", REFERENCE)
def test_scheduler_matches_reference_vectors(name):
    scheduler, (steps, expected) = FsrsScheduler(), REFERENCE[name]
    state = ScheduleState()
    actual = []
    for offset, rating in steps:
        now = T0 + timedelta(seconds=offset)
        state = scheduler.schedule(state, Rating[rating], now)
        assert state.due_at is not None and state.stability is not None and state.difficulty is not None
        actual.append(
            [
                state.state.value,
                state.step,
                round(state.stability, 6),
                round(state.difficulty, 6),
                int((state.due_at - now).total_seconds()),
            ]
        )
    assert actual == expected


def test_scheduler_invariants():
    scheduler = FsrsScheduler()
    # The decay factor makes retrievability exactly 0.9 after `stability` days,
    # so at 0.9 desired retention the interval equals the stability.
    for stability in (1.2, 3.7, 12.0, 250.4):
        assert scheduler.retrievability(stability, stability) == pytest.approx(0.9)
        assert scheduler.next_interval_days(stability) == round(stability)
    assert scheduler.next_interval_days(0.01) == 1
    assert scheduler.next_interval_days(1e9) == 36_500
    # Harder ratings never schedule later than easier ones for a review card.
    review = ScheduleState(CardState.REVIEW, None, 10.0, 5.0, T0, T0 - timedelta(days=10))
    due = [scheduler.schedule(review, rating, T0).due_at for rating in Rating]
    assert due == sorted(due)
    # Difficulty stays within [1, 10] under repeated extremes.
    state = ScheduleState()
    for _ in range(30):
        state = scheduler.schedule(state, Rating.AGAIN, T0)
        assert state.difficulty is not None and 1 <= state.difficulty <= 10
    with pytest.raises(ValueError):
        FsrsScheduler(desired_retention=1.0)


# --- API ---------------------------------------------------------------------


@pytest.fixture
def at(monkeypatch):
    """Set the study clock to ``seconds``; returns a setter."""
    current = {"now": int(T0.timestamp())}
    monkeypatch.setattr(clock, "now_seconds", lambda: current["now"])

    def move(seconds):
        current["now"] = seconds
        return seconds

    return move


async def deck_with_cards(client, n=3):
    project = await create(client)
    base = f"/projects/{project['id']}/study/decks"
    deck = (await client.post(base, headers=auth(), json={"name": "Deck"})).json()
    cards = []
    for index in range(n):
        response = await client.post(
            f"{base}/{deck['id']}/cards", headers=auth(), json={"front": f"Q{index}", "back": f"A{index}"}
        )
        cards.append(response.json())
    return project["id"], deck["id"], f"{base}/{deck['id']}", cards


async def set_due(sessions, card_id, due_at):
    async with sessions() as session:
        await session.execute(
            update(StudyCardModel).where(StudyCardModel.id == uuid.UUID(card_id)).values(due_at=due_at)
        )
        await session.commit()


async def rate(client, deck_path, card, rating, expected_reps=None, user="a"):
    return await client.post(
        f"{deck_path}/cards/{card['id']}/reviews",
        headers=auth(user),
        json={"rating": rating, "expected_reps": card["reps"] if expected_reps is None else expected_reps},
    )


@pytest.mark.asyncio
async def test_new_cards_are_due_and_the_queue_is_ordered_by_due_time(project_api, at):
    client, sessions, _ = project_api
    project_id, _, deck_path, cards = await deck_with_cards(client)
    now = at(int(T0.timestamp()))
    assert all(card["state"] == "learning" and card["reps"] == 0 for card in cards)
    await set_due(sessions, cards[0]["id"], now - 10)
    await set_due(sessions, cards[1]["id"], now - 500)
    await set_due(sessions, cards[2]["id"], now + 60)
    queue = (await client.get(f"{deck_path}/review", headers=auth())).json()
    assert [item["id"] for item in queue["items"]] == [cards[1]["id"], cards[0]["id"]]
    assert queue["due_count"] == 2
    assert queue["now"] == now
    # Ties on due time fall back to id order.
    await set_due(sessions, cards[2]["id"], now - 500)
    queue = (await client.get(f"{deck_path}/review", headers=auth(), params={"limit": 2})).json()
    tied = sorted([cards[1]["id"], cards[2]["id"]])
    assert [item["id"] for item in queue["items"]] == tied
    assert queue["due_count"] == 3
    deck = (await client.get(deck_path, headers=auth())).json()
    assert deck["due_count"] == 3
    summary = (await client.get(f"/projects/{project_id}/study/summary", headers=auth())).json()
    assert summary == {"deck_count": 1, "card_count": 3, "due_count": 3}


@pytest.mark.asyncio
async def test_rating_follows_its_preview_and_appends_a_log(project_api, at):
    client, sessions, _ = project_api
    _, _, deck_path, cards = await deck_with_cards(client, n=1)
    now = at(int(T0.timestamp()) + 5)
    item = (await client.get(f"{deck_path}/review", headers=auth())).json()["items"][0]
    assert item["previews"] == {"again": now + 60, "hard": now + 330, "good": now + 600, "easy": now + 8 * DAY}

    rated = await rate(client, deck_path, item, "good")
    assert rated.status_code == 200, rated.text
    body = rated.json()
    assert body["due_at"] == item["previews"]["good"]
    assert (body["state"], body["reps"], body["lapses"]) == ("learning", 1, 0)
    # The rated card is no longer due, so it leaves the queue.
    queue = (await client.get(f"{deck_path}/review", headers=auth())).json()
    assert queue["items"] == []

    at(now + 600)
    graduated = (await rate(client, deck_path, body, "good")).json()
    assert graduated["state"] == "review"
    assert graduated["due_at"] == now + 600 + 2 * DAY

    async with sessions() as session:
        logs = list(await session.scalars(select(StudyReviewLogModel).order_by(StudyReviewLogModel.reviewed_at)))
    assert [(log.rating, log.previous_state, log.state) for log in logs] == [
        (3, "learning", "learning"),
        (3, "learning", "review"),
    ]
    assert logs[0].previous_due_at <= now and logs[1].due_at == graduated["due_at"]
    assert all(log.user_id == "a" and str(log.card_id) == cards[0]["id"] for log in logs)


@pytest.mark.asyncio
async def test_lapses_count_review_failures_and_relearn(project_api, at):
    client, _, _ = project_api
    _, _, deck_path, cards = await deck_with_cards(client, n=1)
    start = at(int(T0.timestamp()))
    card = (await rate(client, deck_path, cards[0], "easy")).json()
    assert card["state"] == "review"
    at(start + 9 * DAY)
    card = (await rate(client, deck_path, card, "again")).json()
    assert (card["state"], card["lapses"], card["due_at"]) == ("relearning", 1, start + 9 * DAY + 600)
    at(start + 9 * DAY + 600)
    card = (await rate(client, deck_path, card, "good")).json()
    assert (card["state"], card["lapses"]) == ("review", 1)


@pytest.mark.asyncio
async def test_repeated_submission_is_rejected_not_counted_twice(project_api, at):
    client, sessions, _ = project_api
    _, _, deck_path, cards = await deck_with_cards(client, n=1)
    at(int(T0.timestamp()))
    assert (await rate(client, deck_path, cards[0], "good")).status_code == 200
    again = await rate(client, deck_path, cards[0], "easy", expected_reps=0)
    assert again.status_code == 409
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(StudyReviewLogModel)) == 1
        card = await session.get(StudyCardModel, uuid.UUID(cards[0]["id"]))
        assert card is not None and card.reps == 1


@pytest.mark.asyncio
async def test_review_routes_are_owner_and_project_scoped(project_api, at):
    client, sessions, _ = project_api
    project_id, deck_id, deck_path, cards = await deck_with_cards(client, n=1)
    other = await create(client, name="Other")
    assert (await client.get(f"{deck_path}/review", headers=auth("b"))).status_code == 404
    assert (await rate(client, deck_path, cards[0], "good", user="b")).status_code == 404
    assert (await client.get(f"/projects/{project_id}/study/summary", headers=auth("b"))).status_code == 404
    wrong = f"/projects/{other['id']}/study/decks/{deck_id}"
    assert (await client.get(f"{wrong}/review", headers=auth())).status_code == 404
    assert (await rate(client, wrong, cards[0], "good")).status_code == 404
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(StudyReviewLogModel)) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [{"rating": "perfect", "expected_reps": 0}, {"rating": "good"}, {"rating": "good", "expected_reps": -1}],
)
async def test_review_validation(project_api, body):
    client, _, _ = project_api
    _, _, deck_path, cards = await deck_with_cards(client, n=1)
    response = await client.post(f"{deck_path}/cards/{cards[0]['id']}/reviews", headers=auth(), json=body)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_deleting_a_card_deletes_its_review_logs(project_api, at):
    client, sessions, _ = project_api
    _, _, deck_path, cards = await deck_with_cards(client, n=2)
    at(int(T0.timestamp()))
    for card in cards:
        assert (await rate(client, deck_path, card, "good")).status_code == 200
    assert (await client.delete(f"{deck_path}/cards/{cards[0]['id']}", headers=auth())).status_code == 204
    async with sessions() as session:
        remaining = list(await session.scalars(select(StudyReviewLogModel.card_id)))
    assert remaining == [uuid.UUID(cards[1]["id"])]
