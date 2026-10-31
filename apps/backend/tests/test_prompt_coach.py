"""US-51.6: the prompt coach — opt-in, model resolution, unavailable state, parsing and ephemerality."""

import json
import uuid

import pytest
from asterism.db.base_model import Base
from asterism.domains.chat.title_model import PlanTitleModel
from asterism.domains.llm.draft import DraftModel
from asterism.domains.prompt_templates import coach
from asterism.domains.settings import service as settings_service
from sqlalchemy import func, select
from test_chat_title_model import GLOBAL_A
from test_chat_title_model import titles as _titles
from test_chatgpt_connection import chatgpt as _chatgpt
from test_chatgpt_connection import connect, enable
from test_chatgpt_plan_models import plan_model_id
from test_chatgpt_plan_usage import COMPLETED, stream, text
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
chatgpt = _chatgpt
titles = _titles
STATUS = "/prompt-templates/coach"
REVIEW = "/prompt-templates/coach/review"
DRAFT = "Write about dogs."


class FakeModel:
    def __init__(self, reply: str | Exception):
        self.reply = reply
        self.messages = []

    async def invoke(self, messages):
        self.messages.append(messages)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def review_json(*suggestions):
    return json.dumps({"suggestions": list(suggestions)})


@pytest.fixture
def coached(project_api, monkeypatch):
    client, sessions, _ = project_api
    state = {"model": FakeModel(review_json()), "calls": []}

    async def resolve(user_id, model_id):
        state["calls"].append((user_id, model_id))
        return state["model"]

    monkeypatch.setattr(coach, "resolve_title_model", resolve)
    return client, sessions, state


async def turn_on(client, user="a", value=True):
    response = await client.put(f"/settings/user/{coach.ENABLED_SETTING}", headers=auth(user), json={"value": value})
    assert response.status_code == 200, response.text


async def row_counts(sessions):
    async with sessions() as session:
        return {
            table.name: await session.scalar(select(func.count()).select_from(table))
            for table in Base.metadata.sorted_tables
        }


@pytest.mark.asyncio
async def test_the_coach_is_off_by_default_and_opted_into_per_user(coached):
    client, _, state = coached

    settings = (await client.get("/settings/user", headers=auth())).json()
    assert settings["prompt_coach_enabled"] is False
    assert (await client.get(STATUS, headers=auth())).json() == {"enabled": False, "available": False}
    refused = await client.post(REVIEW, headers=auth(), json={"prompt": DRAFT})
    assert refused.status_code == 403
    assert state["calls"] == []

    await turn_on(client)
    assert (await client.get(STATUS, headers=auth())).json() == {"enabled": True, "available": True}
    # Another user's opt-in is their own.
    assert (await client.get(STATUS, headers=auth("b"))).json()["enabled"] is False
    bad = await client.put(f"/settings/user/{coach.ENABLED_SETTING}", headers=auth(), json={"value": "yes"})
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_without_a_usable_model_the_coach_is_unavailable(coached):
    client, _, state = coached
    await turn_on(client)
    state["model"] = None

    assert (await client.get(STATUS, headers=auth())).json() == {"enabled": True, "available": False}
    response = await client.post(REVIEW, headers=auth(), json={"prompt": DRAFT})
    assert response.status_code == 503
    assert "draft model" in response.json()["detail"]


@pytest.mark.asyncio
async def test_a_review_returns_applicable_suggestions_in_rubric_order(coached):
    client, _, state = coached
    await turn_on(client)
    model_id = str(uuid.uuid4())
    state["model"] = FakeModel(
        "```json\n"
        + review_json(
            {"criterion": "output_format", "message": "Say  what shape.", "find": None, "text": "Use three bullets."},
            {"criterion": "goal", "message": "Be specific.", "find": "about dogs", "text": "about caring for a puppy"},
            {"criterion": "goal", "message": "Duplicate criterion.", "find": None, "text": "ignored"},
            {"criterion": "audience", "message": "Not in the draft.", "find": "cats", "text": "kittens"},
            {"criterion": "tone", "message": "Unknown criterion.", "find": None, "text": "x"},
            {"criterion": "examples", "message": "", "find": None, "text": "x"},
            {"criterion": "context", "message": "No edit.", "find": None, "text": "  "},
            "not an object",
        )
        + "\n```",
    )

    response = await client.post(REVIEW, headers=auth(), json={"prompt": DRAFT, "model_id": model_id})

    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "suggestions": [
            {
                "id": "goal",
                "criterion": "goal",
                "message": "Be specific.",
                "find": "about dogs",
                "text": "about caring for a puppy",
            },
            {
                "id": "output_format",
                "criterion": "output_format",
                "message": "Say what shape.",
                "find": None,
                "text": "Use three bullets.",
            },
        ],
    }
    # The composer's selected model is passed to the shared title-model resolution.
    assert state["calls"] == [("a", uuid.UUID(model_id))]
    system, user = state["model"].messages[0]
    assert "goal" in system.content and "output_format" in system.content and "examples" in system.content
    assert f"<draft>\n{DRAFT}\n</draft>" in user.content


@pytest.mark.asyncio
async def test_failures_and_unreadable_reviews_are_bad_gateway(coached):
    client, _, state = coached
    await turn_on(client)
    for reply in [RuntimeError("provider down"), "Looks great!", '{"suggestions": "none"}', "{not json}"]:
        state["model"] = FakeModel(reply)
        response = await client.post(REVIEW, headers=auth(), json={"prompt": DRAFT})
        assert response.status_code == 502, reply
        assert "provider down" not in response.text


@pytest.mark.asyncio
async def test_review_input_is_bounded(coached):
    client, _, state = coached
    await turn_on(client)
    for body in [{"prompt": ""}, {"prompt": "x" * 16_001}, {"prompt": DRAFT, "extra": 1}]:
        assert (await client.post(REVIEW, headers=auth(), json=body)).status_code in (400, 422)
    whitespace = await client.post(REVIEW, headers=auth(), json={"prompt": "   "})
    assert whitespace.json() == {"suggestions": []}
    assert state["model"].messages == []


@pytest.mark.asyncio
async def test_reviews_are_ephemeral(coached):
    client, sessions, state = coached
    await turn_on(client)
    state["model"] = FakeModel(
        review_json({"criterion": "audience", "message": "Who?", "find": None, "text": "For kids."})
    )
    before = await row_counts(sessions)

    for _ in range(2):
        assert (await client.post(REVIEW, headers=auth(), json={"prompt": DRAFT})).status_code == 200

    assert await row_counts(sessions) == before


def test_parser_caps_long_messages_and_rejects_oversized_edits():
    long = "word " * 200
    review = coach.parse_review(
        review_json(
            {"criterion": "goal", "message": long, "find": None, "text": "ok"},
            {"criterion": "context", "message": "Too long.", "find": None, "text": "x" * 2_001},
            {"criterion": "constraints", "message": "No-op rewrite.", "find": "dogs", "text": "dogs"},
        ),
        DRAFT,
    )
    assert [item.criterion for item in review.suggestions] == ["goal"]
    assert len(review.suggestions[0].message) == 300


# --- Model resolution reuses the chat-title rule (US-50.1) ---------------------


@pytest.mark.asyncio
async def test_reviews_run_on_the_draft_model_when_it_is_usable(titles):
    client, sessions, double, responses = titles
    await enable(client)
    await connect(client, double)
    async with sessions() as session:
        await settings_service.upsert_app_setting("draft_model_id", str(GLOBAL_A), session=session)

    model = await coach.resolve_title_model("a", uuid.UUID(await plan_model_id(sessions)))

    assert isinstance(model, DraftModel)
    assert responses.requests == []


@pytest.mark.asyncio
async def test_without_a_draft_model_reviews_run_on_the_owners_plan(titles, monkeypatch):
    client, sessions, double, responses = titles
    await enable(client)
    await connect(client, double)
    await turn_on(client)
    responses.replies.append(
        stream(
            text(review_json({"criterion": "audience", "message": "Who?", "find": None, "text": "For kids."})),
            COMPLETED,
        ),
    )

    assert (await client.get(STATUS, headers=auth())).json() == {"enabled": True, "available": True}
    assert isinstance(await coach.resolve_title_model("a", None), PlanTitleModel)
    response = await client.post(REVIEW, headers=auth(), json={"prompt": DRAFT})

    assert response.status_code == 200, response.text
    assert [item["criterion"] for item in response.json()["suggestions"]] == ["audience"]
    assert responses.requests == [("Bearer access-1", "gpt-plan")]


@pytest.mark.asyncio
async def test_another_users_plan_never_reviews(titles):
    client, sessions, double, responses = titles
    await enable(client)
    await connect(client, double)
    await turn_on(client, "b")

    assert (await client.get(STATUS, headers=auth("b"))).json() == {"enabled": True, "available": False}
    response = await client.post(REVIEW, headers=auth("b"), json={"prompt": DRAFT})
    assert response.status_code == 503
    assert responses.requests == []
