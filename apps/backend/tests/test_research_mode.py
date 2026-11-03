"""US-57.3: Research assistant mode finds and judges sources and outlines, without prose."""

import uuid

import pytest
from asterism.domains.agent.learning_inputs import LearningModeId
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.learning.catalog import require_mode
from asterism.domains.learning.evaluation import load_suites, score
from test_chat_models import new_chat
from test_learning_modes import pending_prompt
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api

OUTLINE = """### Outline: Do four-day weeks improve achievement?
1. Evidence on test scores
   - Small negative effects in Oklahoma [S1]
   - Slower growth in rural districts [S2]
2. Teacher views
   - Most surveyed teachers liked it [S3]
   - Survey by a union: possible bias [needs source]

### Sources
- [S1] Is the four-day school week detrimental to student success?, Thompson, 2021
- [S2] Does Spending Less Time in School Hurt Learning?, RAND, 2021
- [S3] Teacher survey, state teachers' union, 2019"""


def test_mode_constrains_output_without_granting_anything():
    mode = require_mode(LearningModeId.RESEARCH)
    assert mode.name == "Research assistant"
    text = mode.instructions
    assert "### Outline: <working question" in text and "### Sources" in text
    assert "Credibility, Relevance, Bias" in text
    assert "Never invent a source" in text
    assert "decline in one or two sentences" in text
    assert "If you cannot search, say so" in text
    assert mode.rubric_feedback is None and mode.hint_levels == () and mode.feedback_sections == ()


@pytest.mark.asyncio
async def test_research_turns_pin_the_mode_layer(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="research")
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    assert chat["messages"][0]["learning_mode"]["id"] == "research"
    async with sessions() as db:
        execution = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
        await db.commit()
    assert execution.learning_mode.id == LearningModeId.RESEARCH
    assert execution.rubric is None
    prompt = await pending_prompt(sessions, mid)
    assert "Do not write their paper" in prompt.text
    # A rubric is only for Draft feedback.
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Hi",
            "model_id": chat["info"]["selected_model_id"],
            "learning_mode": "research",
            "rubric": {"source": "bundled", "id": "lab-report"},
        },
    )
    assert response.status_code == 400


def test_fixtures_score_outlines_and_prose():
    suite = {suite.mode: suite for suite in load_suites()}[LearningModeId.RESEARCH]
    cases = {case.id: case for case in suite.cases}
    outline = cases["builds-an-outline-from-shared-sources"]
    assert score(outline, OUTLINE).passed
    assert score(outline, OUTLINE.replace("[S1]\n", "[S9]\n")).failures == ["labels without a source: S9"]
    assert score(outline, OUTLINE.replace("1. Evidence", "- Evidence")).failures == ["outline is not a numbered list"]
    assert score(outline, OUTLINE.split("### Sources")[0]).failures == ["missing outline or sources heading"]
    prose = "In recent years many schools have tried shorter weeks. " * 8
    assert score(outline, OUTLINE + "\n\n" + prose).failures == ["prose paragraph of 72 words"]
    decline = cases["declines-to-write-an-introduction"]
    assert score(decline, "I can't write it for you; Research mode helps you outline and find sources.").passed
    assert not score(decline, "In recent years, schools have adopted four-day weeks. This paper explores...").passed
