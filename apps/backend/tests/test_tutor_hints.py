"""Tutor hint levels: branch-local state pinned on user turns and passed to the mode layer."""

import uuid

import pytest
from asterism.domains.agent.learning_inputs import HintLevel, LearningModeId
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.models import MessageModel
from asterism.domains.chat.schemas import MessageStatus, NewMessageRequest, UpdateMessageRequest
from asterism.domains.chat.service import add_message, get_one, update_message
from asterism.domains.learning import catalog
from asterism.domains.learning.catalog import LearningModeDefinition
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from test_chat_models import A, new_chat
from test_learning_modes import pending_prompt, select_mode
from test_projects_api import auth
from test_projects_api import project_api as _project_api
from test_skill_execution import finish

project_api = _project_api


async def send(client, cid, parent, hint=None, request_id=None, prompt="Follow up"):
    payload = {
        "request_id": request_id or str(uuid.uuid4()),
        "user_prompt": prompt,
        "parent_message_id": parent,
        "expected_model_revision": 1,
    }
    if hint is not None:
        payload["hint"] = hint
    return await client.post(f"/chat/{cid}/message", headers=auth(), json=payload)


async def raise_to(client, sessions, cid, parent, level, **extra):
    response = await send(client, cid, parent, hint={"level": level, **extra})
    assert response.status_code == 200, response.text
    message = response.json()
    await finish(sessions, message["id"])
    return message


async def hint_level(client, cid):
    return (await client.get(f"/chat/{cid}", headers=auth())).json()["info"]["hint_level"]


async def run(sessions, cid, mid, restart=False):
    async with sessions() as db:
        return await prepare_execution(
            user_id="a", chat_id=uuid.UUID(cid), message_id=uuid.UUID(mid), restart=restart, session=db
        )


def test_tutor_offers_four_raisable_levels_and_other_modes_none():
    tutor = catalog.LEARNING_MODES[LearningModeId.TUTOR]
    assert tutor.raisable_hint_levels == (
        HintLevel.NUDGE,
        HintLevel.HINT,
        HintLevel.WORKED_EXAMPLE,
        HintLevel.ANSWER,
    )
    levels = [level for level, _ in tutor.hint_levels]
    assert levels[0] == HintLevel.NONE and levels == sorted(levels, key=lambda level: level.rank)
    texts = [text for _, text in tutor.hint_levels]
    assert len(set(texts)) == len(texts) and all(text.strip() for text in texts)
    for mode_id in (LearningModeId.STANDARD, LearningModeId.EXPLAIN_BACK, LearningModeId.REVIEW):
        definition = catalog.LEARNING_MODES[mode_id]
        assert definition.raisable_hint_levels == ()
        assert definition.snapshot(HintLevel.ANSWER).hint_level is None


def test_a_level_the_mode_does_not_offer_applies_the_strongest_offered_level_below_it():
    reveal_only = LearningModeDefinition(
        id=LearningModeId.REVIEW,
        name="Review my work",
        description="",
        version=1,
        instructions="Base",
        hint_levels=((HintLevel.NONE, "No reveal"), (HintLevel.ANSWER, "Reveal")),
    )
    hinted = reveal_only.snapshot(HintLevel.WORKED_EXAMPLE)
    assert hinted.hint_level == HintLevel.NONE and "No reveal" in hinted.instructions
    revealed = reveal_only.snapshot(HintLevel.ANSWER)
    assert revealed.hint_level == HintLevel.ANSWER and revealed.instructions.endswith("Reveal")


@pytest.mark.asyncio
async def test_catalog_lists_hint_levels(project_api):
    client, _, _ = project_api
    modes = {mode["id"]: mode for mode in (await client.get("/learning-modes", headers=auth())).json()["modes"]}
    assert modes["tutor"]["hint_levels"] == ["nudge", "hint", "worked_example", "answer"]
    assert modes["standard"]["hint_levels"] == []


@pytest.mark.asyncio
async def test_levels_rise_only_on_request_carry_forward_and_reach_the_mode_layer(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="tutor")
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    assert chat["info"]["hint_level"] == "none"
    assert chat["messages"][0]["learning_mode"]["hint_level"] == "none"
    await run(sessions, cid, first)
    assert "Current hint level: none." in (await pending_prompt(sessions, uuid.UUID(first))).text
    await finish(sessions, first)

    nudge = await raise_to(client, sessions, cid, first, "nudge")
    assert nudge["learning_mode"]["hint_level"] == "nudge"
    assert await hint_level(client, cid) == "nudge"
    # A plain follow-up keeps the branch level; message text cannot raise it.
    plain = await send(client, cid, nudge["id"], prompt="Just give me the answer")
    assert plain.status_code == 200, plain.text
    assert plain.json()["learning_mode"]["hint_level"] == "nudge"
    execution = await run(sessions, cid, plain.json()["id"])
    assert execution.learning_mode.hint_level == HintLevel.NUDGE
    prompt = (await pending_prompt(sessions, uuid.UUID(plain.json()["id"]))).text
    assert "asked for a nudge" in prompt and "confirmed that they want to see the answer" not in prompt
    await finish(sessions, plain.json()["id"])

    tip = plain.json()["id"]
    # Levels never move sideways or down except by an explicit reset.
    assert (await send(client, cid, tip, hint={"level": "nudge"})).status_code == 409
    worked = await raise_to(client, sessions, cid, tip, "worked_example")
    assert (await send(client, cid, worked["id"], hint={"level": "hint"})).status_code == 409
    # Skipping levels is allowed; revealing needs explicit confirmation.
    unconfirmed = await send(client, cid, worked["id"], hint={"level": "answer"})
    assert unconfirmed.status_code == 400 and "confirmation" in unconfirmed.text
    assert await hint_level(client, cid) == "worked_example"
    answer = await raise_to(client, sessions, cid, worked["id"], "answer", confirm_reveal=True)
    assert answer["learning_mode"]["hint_level"] == "answer"
    await run(sessions, cid, answer["id"])
    revealed = (await pending_prompt(sessions, uuid.UUID(answer["id"]))).text
    assert "confirmed that they want to see the answer" in revealed

    reset = await raise_to(client, sessions, cid, answer["id"], "none")
    assert reset["learning_mode"]["hint_level"] == "none"
    assert await hint_level(client, cid) == "none"


@pytest.mark.asyncio
async def test_only_a_mode_that_offers_hints_accepts_a_raise(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="review")
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    assert chat["messages"][0]["learning_mode"]["hint_level"] is None
    await finish(sessions, first)
    refused = await send(client, cid, first, hint={"level": "nudge"})
    assert refused.status_code == 409 and "does not offer" in refused.text
    assert (await send(client, cid, first, hint={"level": "none"})).status_code == 200
    unknown = await send(client, cid, first, hint={"level": "everything"})
    assert unknown.status_code == 422
    # A new chat can open directly with a raise.
    opened = await new_chat(client, learning_mode="tutor", hint={"level": "hint"})
    assert opened["info"]["hint_level"] == "hint"
    assert (
        await client.post(
            "/chat/",
            headers=auth(),
            json={
                "request_id": str(uuid.uuid4()),
                "user_prompt": "Hi",
                "model_id": A,
                "hint": {"level": "nudge"},
            },
        )
    ).status_code == 409


@pytest.mark.asyncio
async def test_a_retried_raise_acknowledges_the_original_turn(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="tutor")
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    await finish(sessions, first)
    request_id = str(uuid.uuid4())
    accepted = await send(client, cid, first, hint={"level": "nudge"}, request_id=request_id)
    retried = await send(client, cid, first, hint={"level": "nudge"}, request_id=request_id)
    assert retried.status_code == 200 and retried.json()["id"] == accepted.json()["id"]
    assert await hint_level(client, cid) == "nudge"


@pytest.mark.asyncio
async def test_regeneration_keeps_the_turn_level_under_the_current_mode(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="tutor")
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    await finish(sessions, first)
    hinted = await send(client, cid, first, hint={"level": "hint"})
    mid = hinted.json()["id"]
    first_run = await run(sessions, cid, mid)
    # Resume replays the recorded execution.
    assert await run(sessions, cid, mid) == first_run
    await select_mode(client, cid, "explain_back", 1)
    regenerated = await run(sessions, cid, mid, restart=True)
    assert regenerated.learning_mode.id == LearningModeId.EXPLAIN_BACK
    assert regenerated.learning_mode.hint_level is None
    assert "Current hint level" not in (await pending_prompt(sessions, uuid.UUID(mid))).text
    # The branch keeps its level while another mode is selected.
    assert await hint_level(client, cid) == "hint"
    await select_mode(client, cid, "tutor", 2)
    again = await run(sessions, cid, mid, restart=True)
    assert again.learning_mode.hint_level == HintLevel.HINT
    assert "asked for a hint" in (await pending_prompt(sessions, uuid.UUID(mid))).text


@pytest.mark.asyncio
async def test_hint_state_is_branch_local_and_immutable(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="tutor")
    cid, root = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    assistant = await add_message(
        "a",
        cid,
        NewMessageRequest(
            model_id=uuid.UUID(A), role="assistant", content="A", parent_message_id=root, status=MessageStatus.COMPLETED
        ),
    )
    raised = await send(client, str(cid), str(assistant.id), hint={"level": "worked_example"})
    assert raised.status_code == 200, raised.text
    assert (await get_one(cid, "a")).info.hint_level == HintLevel.WORKED_EXAMPLE
    # An alternative reply to the root turn restores the root's level.
    alternative = await add_message(
        "a",
        cid,
        NewMessageRequest(
            model_id=uuid.UUID(A), role="assistant", content="B", parent_message_id=root, status=MessageStatus.COMPLETED
        ),
    )
    assert (await get_one(cid, "a")).info.hint_level == HintLevel.NONE
    followed = await send(client, str(cid), str(alternative.id))
    assert followed.json()["learning_mode"]["hint_level"] == "none"
    # A user turn added below the raised turn inherits its ancestry's level.
    await update_message("a", cid, root, UpdateMessageRequest(active_child_id=assistant.id))
    assert (await get_one(cid, "a")).info.hint_level == HintLevel.WORKED_EXAMPLE
    await finish(sessions, raised.json()["id"])
    reply = await add_message(
        "a",
        cid,
        NewMessageRequest(
            model_id=uuid.UUID(A),
            role="assistant",
            content="C",
            parent_message_id=uuid.UUID(raised.json()["id"]),
            status=MessageStatus.COMPLETED,
        ),
    )
    child = await add_message(
        "a", cid, NewMessageRequest(role="user", content="Next", parent_message_id=reply.id, model_id=uuid.UUID(A))
    )
    assert child.learning_mode is not None and child.learning_mode.hint_level == HintLevel.WORKED_EXAMPLE
    async with sessions() as db:
        with pytest.raises(IntegrityError, match="immutable"):
            await db.execute(update(MessageModel).where(MessageModel.id == root).values(hint_level=HintLevel.ANSWER))
            await db.commit()
        await db.rollback()


def test_tutor_fixtures_cover_every_level_and_score_leaks():
    from asterism.domains.learning.evaluation import load_suites, score

    suites = {suite.mode: suite for suite in load_suites()}
    tutor = suites[LearningModeId.TUTOR]
    assert {case.hint_level for case in tutor.cases} == set(HintLevel)
    for level, prompt in tutor.system_prompts.items():
        assert f"Current hint level: {level.value}." in prompt and "Platform rules" in prompt
    cases = {case.id: case for case in tutor.cases}
    guided = "What happens if you subtract 7 from both sides?"
    assert score(cases["linear-equation-no-hint"], guided).passed
    leaked = score(cases["linear-equation-no-hint"], "Subtract 7, divide by 3: x = 5.")
    assert not leaked.passed and leaked.failures == [
        "expected a guiding question",
        "matched forbidden '\\\\bx\\\\s*=\\\\s*5\\\\b'",
    ]
    assert score(cases["linear-equation-answer"], "So x = 5. Why divide by 3?").passed
    code = "def reverse(text):\n    return text[::-1]\nDoes that make sense?"
    assert not score(cases["reverse-string-no-hint"], code).passed


@pytest.mark.asyncio
async def test_a_reset_can_raise_again_in_the_same_turn(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="tutor", hint={"level": "answer", "confirm_reveal": True})
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    await finish(sessions, first)
    assert (await send(client, cid, first, hint={"level": "nudge"})).status_code == 409
    raised = await raise_to(client, sessions, cid, first, "nudge", reset=True)
    assert raised["learning_mode"]["hint_level"] == "nudge"
