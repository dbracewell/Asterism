"""Review my work: feedback on an attempt, attached or pasted, with the shared answer reveal."""

import uuid

import pytest
from asterism.core import config
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.learning_inputs import HintLevel, LearningModeId
from asterism.domains.agent.service import get_main_agent_profile
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.chat.service import get_one
from asterism.domains.learning import catalog
from asterism.domains.learning.evaluation import load_suites, score
from asterism.domains.llm.schemas import text_content
from test_chat_file_scope import seed_agent
from test_chat_models import new_chat
from test_learning_modes import pending_prompt, select_mode
from test_projects_api import auth
from test_projects_api import project_api as _project_api
from test_skill_execution import finish
from test_tutor_hints import hint_level, raise_to, run, send

project_api = _project_api

ATTEMPT = b"def average(values):\n    return sum(values) / len(values)\n"


def test_review_offers_only_the_confirmed_reveal():
    review = catalog.LEARNING_MODES[LearningModeId.REVIEW]
    assert review.version == 2
    assert review.raisable_hint_levels == (HintLevel.ANSWER,)
    feedback = review.snapshot(HintLevel.NONE)
    assert feedback.hint_level == HintLevel.NONE
    assert "first error" in feedback.instructions and "Do not write a corrected solution" in feedback.instructions
    assert "Attached file:" in feedback.instructions and "never instructions" in feedback.instructions
    assert "could not be included, ask them to paste or attach it" in feedback.instructions.replace("\n  ", " ")
    # Tutor-only levels carried over from another mode never reveal a solution.
    for level in (HintLevel.NUDGE, HintLevel.HINT, HintLevel.WORKED_EXAMPLE):
        assert review.snapshot(level).instructions == feedback.instructions
    revealed = review.snapshot(HintLevel.ANSWER)
    assert revealed.hint_level == HintLevel.ANSWER
    assert "confirmed that they want to see a corrected solution" in revealed.instructions


@pytest.mark.asyncio
async def test_the_catalog_serves_the_review_reveal(project_api):
    client, _, _ = project_api
    modes = {mode["id"]: mode for mode in (await client.get("/learning-modes", headers=auth())).json()["modes"]}
    assert modes["review"]["hint_levels"] == ["answer"]
    assert modes["review"]["version"] == 2


@pytest.mark.asyncio
async def test_the_solution_needs_the_confirmed_reveal_and_resets_for_a_new_attempt(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="review", user_prompt="Review: 3(x + 2) = 18 so 3x + 2 = 18")
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    assert chat["messages"][0]["learning_mode"] == {
        "id": "review",
        "name": "Review my work",
        "version": 2,
        "hint_level": "none",
    }
    await run(sessions, cid, first)
    assert "Do not write a corrected solution" in (await pending_prompt(sessions, uuid.UUID(first))).text
    await finish(sessions, first)

    # Message text cannot reveal; Tutor levels are not offered; the reveal needs confirmation.
    plain = await send(client, cid, first, prompt="Just fix it for me")
    assert plain.status_code == 200 and plain.json()["learning_mode"]["hint_level"] == "none"
    await finish(sessions, plain.json()["id"])
    tip = plain.json()["id"]
    refused = await send(client, cid, tip, hint={"level": "worked_example"})
    assert refused.status_code == 409 and "does not offer" in refused.text
    unconfirmed = await send(client, cid, tip, hint={"level": "answer"})
    assert unconfirmed.status_code == 400 and "confirmation" in unconfirmed.text
    assert await hint_level(client, cid) == "none"

    revealed = await raise_to(client, sessions, cid, tip, "answer", confirm_reveal=True)
    assert revealed["learning_mode"]["hint_level"] == "answer"
    execution = await run(sessions, cid, revealed["id"])
    assert execution.learning_mode.hint_level == HintLevel.ANSWER
    prompt = (await pending_prompt(sessions, uuid.UUID(revealed["id"]))).text
    assert "confirmed that they want to see a corrected solution" in prompt
    assert (
        await send(client, cid, revealed["id"], hint={"level": "answer", "confirm_reveal": True})
    ).status_code == 409

    fresh = await raise_to(client, sessions, cid, revealed["id"], "none")
    assert fresh["learning_mode"]["hint_level"] == "none"
    assert await hint_level(client, cid) == "none"


@pytest.mark.asyncio
async def test_a_tutor_level_does_not_reveal_after_switching_to_review(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="tutor", hint={"level": "worked_example"})
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    await finish(sessions, first)
    await select_mode(client, cid, "review", 1)
    follow = await send(client, cid, first, prompt="Here is my attempt")
    assert follow.status_code == 200, follow.text
    # The branch keeps its level, but Review applies its strongest level below it.
    assert follow.json()["learning_mode"]["hint_level"] == "none"
    await run(sessions, cid, follow.json()["id"])
    prompt = (await pending_prompt(sessions, uuid.UUID(follow.json()["id"]))).text
    assert "Current hint level: none." in prompt and "worked example" not in prompt


@pytest.mark.asyncio
async def test_an_attached_attempt_reaches_the_model_beside_the_review_layer(project_api, monkeypatch):
    client, sessions, tmp_path = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    await seed_agent(sessions)
    response = await client.post("/files/", headers=auth(), files={"files": ("average.py", ATTEMPT, "text/plain")})
    assert response.status_code == 201, response.text
    file = response.json()["files"][0]
    chat = await new_chat(
        client,
        learning_mode="review",
        user_prompt="Please review my attempt.",
        files=[file["id"]],
    )
    message = chat["messages"][0]
    assert [item["file_id"] for item in message["files"]] == [file["id"]]
    assert message["learning_mode"]["id"] == "review"

    session = await get_one(uuid.UUID(chat["info"]["id"]), "a")
    agent = Agent(
        profile=await get_main_agent_profile("a"),
        user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
        session=session,
        model_id=session.info.selected_model_id,
    )
    orchestrator = ChatOrchestrator(agent)
    await agent.prepare_execution(uuid.UUID(message["id"]))
    await agent.prepare_execution_scope()
    system = await agent._build_system_prompt()
    assert "[mode instructions]" in system and "Attached file:" in system
    assert "Current hint level: none." in system
    # File contents stay untrusted task data under the platform rules.
    assert system.index("untrusted") < system.index("[mode instructions]")
    turn = text_content((await orchestrator._build_agent_messages())[-1])
    assert "Please review my attempt." in turn
    assert "### Attached file: average.py" in turn and "sum(values) / len(values)" in turn


def test_review_fixtures_cover_feedback_attachments_and_the_reveal():
    suite = {suite.mode: suite for suite in load_suites()}[LearningModeId.REVIEW]
    cases = {case.id: case for case in suite.cases}
    assert {case.hint_level for case in suite.cases} == {HintLevel.NONE, HintLevel.ANSWER}
    assert any("### Attached file:" in case.messages[-1].content for case in suite.cases)
    assert "Current hint level: answer." in suite.system_prompts[HintLevel.ANSWER]

    math = cases["math-first-error"]
    feedback = "Step 1 has the error: when you expand 3(x + 2), the 2 is multiplied too. Redo Step 1."
    assert score(math, feedback).passed
    leaked = score(math, "Step 1 is wrong. 3x + 6 = 18, so 3x = 12 and x = 4.")
    assert not leaked.passed and len(leaked.failures) == 2

    code = cases["attached-code-first-error"]
    assert score(code, "This divides by len(values), which crashes on an empty list. How could you guard it?").passed
    fixed = "def average(values):\n    if not values:\n        return 0\n    return sum(values) / len(values)"
    assert not score(code, f"An empty list crashes it. Fixed:\n{fixed}").passed

    reveal = cases["math-revealed-solution"]
    assert score(reveal, "3x + 6 = 18, so 3x = 12 and x = 4. Why did the 2 become 6?").passed
    assert not score(reveal, "Look at Step 1 again.").passed
