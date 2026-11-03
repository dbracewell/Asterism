"""US-57.1: rubric documents, owner-scoped rubric CRUD, the bundled catalog and
rubrics pinned on Draft feedback turns."""

import copy
import uuid

import pytest
from asterism.core.exceptions import BadDataException
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.models import MessageModel
from asterism.domains.learning.catalog import require_mode
from asterism.domains.prompt_templates.rubric_catalog import RUBRICS
from asterism.domains.prompt_templates.rubrics import (
    MAX_LEVELS,
    parse_rubric,
    parse_rubric_json,
    render_rubric,
    serialize_rubric,
)
from sqlalchemy import update
from sqlalchemy.exc import DatabaseError
from test_chat_models import A
from test_projects_api import auth
from test_projects_api import project_api as _project_api
from test_prompt_templates import create as create_template
from test_prompt_templates import templates_api as _templates_api

project_api = _project_api
templates_api = _templates_api
BASE = "/rubrics/"


def rubric(**overrides):
    value = {
        "name": "Short essay",
        "description": "Checks a short essay.",
        "levels": ["Strong", "Adequate", "Weak"],
        "criteria": [
            {
                "label": "Thesis",
                "description": "A clear claim.",
                "descriptors": ["Clear and arguable.", "Present but vague.", "Missing."],
            },
            {"label": "Evidence", "descriptors": ["Well supported.", "Some support.", "Unsupported."]},
        ],
    }
    value.update(overrides)
    return value


async def create(client, user="a", **overrides):
    response = await client.post(BASE, headers=auth(user), json={"document": rubric(**overrides)})
    assert response.status_code == 201, response.text
    return response.json()


async def draft_chat(client, rubric_use=None, mode="draft_feedback", prompt="My draft: Dogs are good."):
    payload = {"request_id": str(uuid.uuid4()), "user_prompt": prompt, "model_id": A, "learning_mode": mode}
    if rubric_use is not None:
        payload["rubric"] = rubric_use
    return await client.post("/chat/", headers=auth(), json=payload)


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


def test_valid_rubric_round_trips_canonically():
    parsed = parse_rubric(rubric())
    assert parse_rubric_json(serialize_rubric(parsed)) == parsed
    assert parsed.criteria[1].description == ""


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"levels": ["Strong", "strong ", "Weak"]}, "level names must be unique"),
        (
            {
                "criteria": [
                    {"label": "Thesis", "descriptors": ["a", "b", "c"]},
                    {"label": " thesis", "descriptors": ["a", "b", "c"]},
                ]
            },
            "criterion names must be unique",
        ),
        ({"criteria": [{"label": "Overall", "descriptors": ["a", "b", "c"]}]}, "reserved"),
        ({"criteria": [{"label": "Thesis", "descriptors": ["a", "b"]}]}, "one descriptor per level"),
        ({"levels": ["Only"]}, "at least 2"),
        ({"levels": [f"L{i}" for i in range(MAX_LEVELS + 1)]}, "at most 6"),
        ({"criteria": []}, "at least 1"),
        ({"name": "Two\nlines"}, "single line"),
        ({"levels": ["Strong", "  ", "Weak"]}, "blank"),
        ({"criteria": [{"label": "Thesis", "descriptors": ["a", " ", "c"]}]}, "blank"),
        ({"extra": True}, "Extra inputs"),
        ({"description": "bad\x00"}, "null characters"),
    ],
)
def test_invalid_rubrics_are_rejected(overrides, message):
    with pytest.raises(BadDataException, match=message):
        parse_rubric(rubric(**overrides))


def test_bundled_rubrics_are_valid_and_render_levels_in_order():
    assert set(RUBRICS) == {"argumentative-essay", "lab-report", "personal-narrative"}
    for bundled in RUBRICS.values():
        assert parse_rubric(bundled.document.model_dump()) == bundled.document
    text = render_rubric(parse_rubric(rubric()))
    assert text.startswith("### Rubric: Short essay")
    assert "Levels, from highest to lowest: Strong, Adequate, Weak." in text
    assert "#### Criterion: Thesis\nA clear claim.\n- Strong: Clear and arguable.\n- Adequate:" in text
    assert "#### Criterion: Evidence\n- Strong: Well supported." in text


def test_draft_feedback_mode_uses_the_reply_format():
    mode = require_mode("draft_feedback")
    assert mode.rubric_feedback is not None
    assert "Estimated level: <one level name" in mode.instructions
    assert "### Overall" in mode.instructions
    assert "Example rewrite" in mode.instructions
    assert all(require_mode(other).rubric_feedback is None for other in ("standard", "review", "explain_back"))


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_crud_is_owner_scoped_and_revision_checked(templates_api):
    client, _, _ = templates_api
    assert (await client.get(BASE)).status_code == 401
    created = await create(client)
    assert created["revision"] == 1 and created["name"] == "Short essay"
    rid = created["id"]
    assert (await client.get(f"{BASE}{rid}", headers=auth("b"))).status_code == 404
    assert (await client.get(f"{BASE}{uuid.uuid4()}", headers=auth())).status_code == 404
    changed = rubric(name="Renamed")
    stale = await client.put(f"{BASE}{rid}", headers=auth(), json={"document": changed, "expected_revision": 2})
    assert stale.status_code == 409
    foreign = await client.put(f"{BASE}{rid}", headers=auth("b"), json={"document": changed, "expected_revision": 1})
    assert foreign.status_code == 404
    updated = await client.put(f"{BASE}{rid}", headers=auth(), json={"document": changed, "expected_revision": 1})
    assert updated.status_code == 200 and updated.json()["revision"] == 2 and updated.json()["name"] == "Renamed"
    page = (await client.get(f"{BASE}?query=renamed", headers=auth())).json()
    assert [item["id"] for item in page["items"]] == [rid] and "document" not in page["items"][0]
    assert (await client.get(BASE, headers=auth("b"))).json()["total"] == 0
    assert (await client.delete(f"{BASE}{rid}?expected_revision=1", headers=auth())).status_code == 409
    assert (await client.delete(f"{BASE}{rid}?expected_revision=2", headers=auth("b"))).status_code == 404
    assert (await client.delete(f"{BASE}{rid}?expected_revision=2", headers=auth())).status_code == 204
    assert (await client.get(f"{BASE}{rid}", headers=auth())).status_code == 404


@pytest.mark.asyncio
async def test_semantic_errors_are_400_and_shape_errors_422(templates_api):
    client, _, _ = templates_api
    bad = rubric(criteria=[{"label": "Thesis", "descriptors": ["a", "b"]}])
    assert (await client.post(BASE, headers=auth(), json={"document": bad})).status_code == 400
    shape = copy.deepcopy(rubric())
    shape["criteria"][0]["points"] = 3
    assert (await client.post(BASE, headers=auth(), json={"document": shape})).status_code == 422


@pytest.mark.asyncio
async def test_rubrics_and_prompt_templates_are_separate_kinds(templates_api):
    client, _, _ = templates_api
    owned_rubric = await create(client)
    template = await create_template(client)
    assert (await client.get(f"/prompt-templates/{owned_rubric['id']}", headers=auth())).status_code == 404
    assert (await client.get(f"{BASE}{template['id']}", headers=auth())).status_code == 404
    templates = (await client.get("/prompt-templates/", headers=auth())).json()["items"]
    rubrics = (await client.get(BASE, headers=auth())).json()["items"]
    assert [item["id"] for item in templates] == [template["id"]]
    assert [item["id"] for item in rubrics] == [owned_rubric["id"]]
    claim = {"source": "template", "id": owned_rubric["id"], "revision": 1, "level": "guided"}
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={"request_id": str(uuid.uuid4()), "user_prompt": "Hi", "model_id": A, "template": claim},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_bundled_catalog_is_read_only(templates_api):
    client, _, _ = templates_api
    catalog = (await client.get(f"{BASE}bundled", headers=auth())).json()
    assert catalog["version"] == 1
    assert [item["id"] for item in catalog["items"]] == ["argumentative-essay", "lab-report", "personal-narrative"]
    one = await client.get(f"{BASE}bundled/lab-report", headers=auth())
    assert one.status_code == 200 and one.json()["document"]["levels"][0] == "Exemplary"
    assert (await client.get(f"{BASE}bundled/missing", headers=auth())).status_code == 404
    assert (await client.post(f"{BASE}bundled", headers=auth(), json={})).status_code == 405


# ---------------------------------------------------------------------------
# Draft feedback turns
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_pins_the_rubric_and_execution_records_its_labels(templates_api):
    client, sessions, _ = templates_api
    response = await draft_chat(client, {"source": "bundled", "id": "argumentative-essay"})
    assert response.status_code == 200, response.text
    chat = response.json()
    label = chat["messages"][0]["rubric"]
    assert label["source"] == "bundled" and label["revision"] == 1 and label["available"] is True
    assert label["document"]["criteria"][0]["label"] == "Thesis"
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as db:
        execution = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
    assert execution.rubric is not None
    assert execution.rubric.name == "Argumentative essay"
    assert execution.rubric.levels == ("Exemplary", "Proficient", "Developing", "Beginning")
    assert execution.rubric.criteria[0] == "Thesis" and execution.rubric.criteria[-1] == "Style and conventions"


@pytest.mark.asyncio
async def test_owned_rubric_snapshot_survives_edits_and_deletion(templates_api):
    client, _, _ = templates_api
    owned = await create(client)
    response = await draft_chat(client, {"source": "owned", "id": owned["id"].upper()})
    assert response.status_code == 200, response.text
    cid = response.json()["info"]["id"]
    edited = rubric(levels=["High", "Middle", "Low"])
    put = await client.put(f"{BASE}{owned['id']}", headers=auth(), json={"document": edited, "expected_revision": 1})
    assert put.status_code == 200
    label = (await client.get(f"/chat/{cid}", headers=auth())).json()["messages"][0]["rubric"]
    assert label["id"] == owned["id"] and label["revision"] == 1
    assert label["document"]["levels"] == ["Strong", "Adequate", "Weak"] and label["available"] is True
    assert (await client.delete(f"{BASE}{owned['id']}?expected_revision=2", headers=auth())).status_code == 204
    label = (await client.get(f"/chat/{cid}", headers=auth())).json()["messages"][0]["rubric"]
    assert label["available"] is False and label["document"]["name"] == "Short essay"


@pytest.mark.asyncio
async def test_invalid_rubric_claims_reject_the_send(templates_api):
    client, _, _ = templates_api
    foreign = await create(client, user="b")
    template = await create_template(client)
    cases = [
        ({"source": "bundled", "id": "missing"}, "draft_feedback", 404),
        ({"source": "owned", "id": foreign["id"]}, "draft_feedback", 404),
        ({"source": "owned", "id": template["id"]}, "draft_feedback", 404),
        ({"source": "owned", "id": "not-a-uuid"}, "draft_feedback", 404),
        ({"source": "bundled", "id": "lab-report", "revision": 1}, "draft_feedback", 422),
        ({"source": "framework", "id": "lab-report"}, "draft_feedback", 422),
        ({"source": "bundled", "id": "lab-report"}, "review", 400),
        ({"source": "bundled", "id": "lab-report"}, "standard", 400),
    ]
    for claim, mode, status in cases:
        response = await draft_chat(client, claim, mode=mode)
        assert response.status_code == status, (claim, mode, response.text)
    assert (await client.get("/chat/", headers=auth())).json()["total"] == 0


@pytest.mark.asyncio
async def test_follow_up_turns_attach_rubrics_independently(templates_api):
    from test_template_provenance import answer

    client, _, _ = templates_api
    chat = (await draft_chat(client)).json()
    cid, root = chat["info"]["id"], chat["messages"][0]["id"]
    assert chat["messages"][0]["rubric"] is None
    reply = await answer(cid, root, "Please choose a rubric.")
    sent = await client.post(
        f"/chat/{cid}/message",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Here it is",
            "parent_message_id": str(reply.id),
            "expected_model_revision": 1,
            "rubric": {"source": "bundled", "id": "personal-narrative"},
        },
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["rubric"]["id"] == "personal-narrative"


@pytest.mark.asyncio
async def test_accepted_rubric_is_immutable(templates_api):
    client, sessions, _ = templates_api
    chat = (await draft_chat(client, {"source": "bundled", "id": "lab-report"})).json()
    mid = uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as db:
        with pytest.raises(DatabaseError, match="immutable"):
            await db.execute(update(MessageModel).where(MessageModel.id == mid).values(accepted_rubric=None))
            await db.commit()


@pytest.mark.asyncio
async def test_model_reads_the_pinned_rubric_in_the_learner_turn(templates_api, monkeypatch):
    from asterism.core.schemas import AuthedUser
    from asterism.domains.agent.agent import Agent
    from asterism.domains.agent.service import get_main_agent_profile
    from asterism.domains.chat.orchestrator import ChatOrchestrator
    from asterism.domains.chat.service import get_one
    from asterism.domains.llm.schemas import TextContentPart
    from test_chat_comparisons import Runtime

    client, sessions, _ = templates_api
    owned = await create(client)
    chat = (await draft_chat(client, {"source": "owned", "id": owned["id"]})).json()
    chat_id = uuid.UUID(chat["info"]["id"])
    # Later edits and deletion do not change what the model reads for this turn.
    assert (await client.delete(f"{BASE}{owned['id']}?expected_revision=1", headers=auth())).status_code == 204
    Runtime(chat_id, sessions, monkeypatch)
    async with sessions() as session:
        opened = await get_one(chat_id, "a", session)
        profile = await get_main_agent_profile("a", session)
    agent = Agent(
        profile=profile,
        user=AuthedUser(id="a", name="A", email="a@example.test", role="user"),
        session=opened,
        model_id=opened.info.selected_model_id,
    )
    history, _ = await ChatOrchestrator(agent)._assemble_agent_messages()
    parts = history[0].content
    assert isinstance(parts, list) and all(isinstance(part, TextContentPart) for part in parts)
    assert [part.text for part in parts] == ["My draft: Dogs are good.", render_rubric(parse_rubric(rubric()))]


# ---------------------------------------------------------------------------
# Evaluation fixtures
# ---------------------------------------------------------------------------

LAB_FEEDBACK = """### Question and hypothesis
**Estimated level:** Proficient

> Does salt make water boil faster?

The question is clear. Say why salt might change boiling.

### Method
Estimated level: Developing

> We heated two pots of water, one with salt.

Name the amount of salt and water.

### Results
Estimated level: **Beginning**

> The salty water boiled at 4 minutes

Add a table with units.

### Analysis and conclusion
Estimated level: Developing

The conclusion ignores error.

### Scientific writing
Estimated level: Proficient

Mostly objective.

### Overall
Clear question; start by tightening the method."""


def test_rubric_fixtures_load_and_score_replies():
    from asterism.domains.agent.learning_inputs import LearningModeId
    from asterism.domains.learning.evaluation import load_suites, score

    suite = {suite.mode: suite for suite in load_suites()}[LearningModeId.DRAFT_FEEDBACK]
    fmt = suite.rubric_format
    cases = {case.id: case for case in suite.cases}
    lab = cases["lab-report-feedback-by-criterion"]
    assert lab.api_messages()[-1]["content"].endswith(render_rubric(RUBRICS["lab-report"].document))
    assert "Rubric:" not in cases["no-rubric-asks-for-one"].api_messages()[-1]["content"]
    assert score(lab, LAB_FEEDBACK, rubric_format=fmt).passed
    missing = score(lab, LAB_FEEDBACK.replace("### Method\n", ""), rubric_format=fmt)
    assert missing.failures == ["missing criterion heading 'Method'"]
    wrong_level = score(lab, LAB_FEEDBACK.replace("Developing\n\n> We", "Okay\n\n> We"), rubric_format=fmt)
    assert wrong_level.failures == ["unknown level 'Okay' for 'Method'"]
    no_level = score(lab, LAB_FEEDBACK.replace("Estimated level: Developing\n\nThe", "The"), rubric_format=fmt)
    assert no_level.failures == ["no level line for 'Analysis and conclusion'"]
    unquoted = "\n".join(line for line in LAB_FEEDBACK.splitlines() if not line.startswith(">"))
    assert score(lab, unquoted, rubric_format=fmt).failures == ["no quoted passage with a note"]
    reordered = LAB_FEEDBACK.replace("### Overall\nClear question; start by tightening the method.", "")
    reordered = "### Overall\nFirst.\n\n" + reordered
    assert score(lab, reordered, rubric_format=fmt).failures == ["rubric headings out of order"]
    asks = cases["no-rubric-asks-for-one"]
    assert score(asks, "Please choose a rubric with the Rubric control.", rubric_format=fmt).passed
    assert not score(asks, "Estimated level: Good. Choose a rubric.", rubric_format=fmt).passed
