"""Explain-back mode: structured feedback headings shared by the prompt, the API and the evaluation set."""

from uuid import UUID

import pytest
from asterism.domains.agent.learning_inputs import FeedbackSectionId, LearningModeId
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.learning import catalog
from asterism.domains.learning.evaluation import EvalSuite, load_suites, score
from pydantic import ValidationError
from test_chat_models import new_chat
from test_learning_modes import pending_prompt
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api

HEADINGS = ("What you got right", "What was missing or wrong", "Follow-up questions")

FEEDBACK = """### What you got right
Plants do use sunlight and water.

### What was missing or wrong
You left out where the carbon comes from.

### Follow-up questions
1. Which gas do plants take in from the air?
2. Where does the energy end up stored?"""


def test_explain_back_defines_three_ordered_sections_used_by_its_instructions():
    definition = catalog.LEARNING_MODES[LearningModeId.EXPLAIN_BACK]
    assert definition.version == 2
    assert [section.id for section in definition.feedback_sections] == list(FeedbackSectionId)
    assert tuple(section.heading for section in definition.feedback_sections) == HEADINGS
    positions = [definition.instructions.index(f"### {heading}") for heading in HEADINGS]
    assert positions == sorted(positions)
    assert "unless they\n  explicitly ask" in definition.instructions
    for mode_id in (LearningModeId.STANDARD, LearningModeId.TUTOR, LearningModeId.REVIEW):
        assert catalog.LEARNING_MODES[mode_id].feedback_sections == ()


@pytest.mark.asyncio
async def test_catalog_serves_feedback_headings_and_the_pinned_layer_carries_them(project_api):
    client, sessions, _ = project_api
    modes = {mode["id"]: mode for mode in (await client.get("/learning-modes", headers=auth())).json()["modes"]}
    assert modes["explain_back"]["feedback_sections"] == [
        {"id": "correct", "heading": "What you got right"},
        {"id": "gaps", "heading": "What was missing or wrong"},
        {"id": "follow_up", "heading": "Follow-up questions"},
    ]
    assert all(modes[mode]["feedback_sections"] == [] for mode in ("standard", "tutor", "review"))
    chat = await new_chat(client, learning_mode="explain_back")
    message = chat["messages"][0]
    assert message["learning_mode"] == {"id": "explain_back", "name": "Explain-back", "version": 2, "hint_level": None}
    cid, mid = UUID(chat["info"]["id"]), UUID(message["id"])
    async with sessions() as db:
        await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
    prompt = (await pending_prompt(sessions, mid)).text
    assert all(f"### {heading}" in prompt for heading in HEADINGS)


def test_explain_back_fixtures_check_structure_and_score_feedback():
    suites = {suite.mode: suite for suite in load_suites()}
    suite = suites[LearningModeId.EXPLAIN_BACK]
    assert suite.feedback_headings == HEADINGS
    assert {case.feedback for case in suite.cases} == {"structured", "free_form"}
    cases = {case.id: case for case in suite.cases}
    assert "### What you got right" in suite.system_prompts[next(iter(suite.system_prompts))]

    partial = cases["photosynthesis-partial-explanation"]
    assert score(partial, FEEDBACK, feedback_headings=HEADINGS).passed
    # Headings at another level or in bold still count.
    bolded = FEEDBACK.replace("### What you got right", "## **What you got right**")
    assert score(partial, bolded, feedback_headings=HEADINGS).passed

    missing = score(partial, FEEDBACK.replace("### What was missing or wrong\n", ""), feedback_headings=HEADINGS)
    assert missing.failures == ["missing feedback heading 'What was missing or wrong'"]
    reordered = "### Follow-up questions\n1. Why?\n\n### What you got right\nA\n\n### What was missing or wrong\nB"
    assert "feedback headings out of order" in score(partial, reordered, feedback_headings=HEADINGS).failures
    three = FEEDBACK + "\n3. And why does that matter?"
    assert score(partial, three, feedback_headings=HEADINGS).failures == [
        "expected one or two follow-up questions, found 3"
    ]

    opener = cases["photosynthesis-asks-for-explanation"]
    assert score(opener, "Explain photosynthesis in your own words?", feedback_headings=HEADINGS).passed
    leaked = score(opener, FEEDBACK + "\nWhat is it?", feedback_headings=HEADINGS)
    assert [failure for failure in leaked.failures if failure.startswith("used feedback heading")] == [
        f"used feedback heading {heading!r}" for heading in HEADINGS
    ]


def test_feedback_checks_need_a_mode_with_sections():
    case = {"id": "x", "messages": [{"role": "user", "content": "Hi"}], "feedback": "structured"}
    with pytest.raises(ValidationError, match="feedback sections"):
        EvalSuite.model_validate({"mode": "tutor", "cases": [case]})
