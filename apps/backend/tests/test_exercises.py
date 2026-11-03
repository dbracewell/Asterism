"""US-55.4: spot-the-error exercises record one hidden error, grade selections and reveal it."""

import json
import uuid

import pytest
from asterism.domains.agent.learning_inputs import LearningModeId
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.exercises import HISTORY_NOTE, MARKER, grade, split_record, streamed_text
from asterism.domains.chat.schemas import MessageStatus, NewMessageRequest
from asterism.domains.chat.service import add_message
from asterism.domains.learning.catalog import require_mode
from asterism.domains.retrieval.citations import citation_key
from test_chat_file_scope import seed_agent, upload
from test_produced_files import produced as _produced
from test_projects_api import auth
from test_projects_api import project_api as _project_api
from test_span_citations import search

produced = _produced
project_api = _project_api
ANSWER = "Water is made of hydrogen and oxygen. It boils at **50 C** at sea level. Ice floats."


def record(quote="It boils at 50 C at sea level.", correction="It boils at 100 C.", source=None):
    body = json.dumps({"quote": quote, "correction": correction, "source": source})
    return f"{ANSWER}\n\n{MARKER}\n{body}\n```"


async def exercise_run(p, files=(), mode="spot_the_error"):
    agent = await seed_agent(p.sessions)
    response = await p.client.post(
        "/chat/",
        headers=auth(),
        json={
            "model_id": "00000000-0000-0000-0000-000000000001",
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Tell me about water",
            "files": list(files),
            "learning_mode": mode,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    chat_id, request_id = uuid.UUID(body["info"]["id"]), uuid.UUID(body["messages"][0]["id"])
    async with p.sessions() as session:
        execution = await prepare_execution(user_id="a", chat_id=chat_id, message_id=request_id, session=session)
        await session.commit()
    assert agent
    return chat_id, request_id, execution


async def save(p, chat_id, parent_id, execution, content, results=None, tool_calls=None):
    async with p.sessions() as session:
        return await add_message(
            "a",
            chat_id,
            NewMessageRequest(
                role="assistant",
                content=content,
                status=MessageStatus.COMPLETED,
                parent_message_id=parent_id,
                execution=execution,
                tool_call_results=results,
                tool_calls=tool_calls,
                model_id=execution.model.id,
            ),
            session,
        )


def path(chat_id, message_id, action):
    return f"/chat/{chat_id}/messages/{message_id}/exercise/{action}"


def test_mode_is_offered_and_explains_the_hidden_record():
    mode = require_mode(LearningModeId.SPOT_THE_ERROR)
    assert mode.name == "Spot the error"
    assert MARKER in mode.instructions and "exactly one deliberate error" in mode.instructions


def test_streamed_text_never_shows_the_record():
    assert streamed_text(f"{ANSWER}\n\n{MARKER}\n{{") == ANSWER
    assert streamed_text(f"{ANSWER}\n\n```asteri") == f"{ANSWER}\n\n"
    assert streamed_text(f"{ANSWER}\n\n`") == f"{ANSWER}\n\n"
    assert streamed_text(ANSWER) == ANSWER


def test_split_and_grade():
    visible, recorded = split_record(record(source="see asterism-cite:0123456789ab"))
    assert visible == ANSWER
    assert recorded and recorded.quote == "It boils at 50 C at sea level." and recorded.source_key == "0123456789ab"
    assert split_record(f"{ANSWER}\n{MARKER}\nnot json")[1] is None

    quote = "It boils at 50 C at sea level."
    assert grade(ANSWER, quote, "50 C") == "found"  # Markdown marks are ignored.
    assert grade(ANSWER, quote, "it boils at 50 c at sea level.") == "found"
    assert grade(ANSWER, quote, "Ice floats.") == "not_it"
    assert grade(ANSWER, quote, ANSWER) == "too_broad"
    assert grade(ANSWER, quote, "Lava is cold") is None


@pytest.mark.asyncio
async def test_record_is_hidden_until_reveal_and_selections_are_graded(produced):
    p = produced
    notes = await upload(p.client, "notes.txt")
    chat_id, request_id, execution = await exercise_run(p, [notes["id"]])
    hit = (notes["id"], "c1", "Water boils at 100 C at sea level.")
    result = search(hit)
    # An intermediate step never carries a record; any stray block is cut.
    first = await save(
        p, chat_id, request_id, execution, f"Searching.\n{MARKER}\n{{}}\n```", [result], [result.tool_call]
    )
    assert first.content == "Searching." and first.exercise is None
    source = f"asterism-cite:{citation_key(uuid.UUID(hit[0]), hit[1])}"
    step = await save(p, chat_id, first.id, execution, record(source=source))

    assert step.content == ANSWER
    body = (await p.client.get(f"/chat/{chat_id}", headers=auth())).json()
    saved = next(m for m in body["messages"] if m["id"] == str(step.id))
    assert saved["content"] == ANSWER
    assert saved["exercise"] == {
        "valid": True,
        "attempts": [],
        "found": False,
        "revealed": False,
        "quote": None,
        "correction": None,
        "source": None,
    }
    # The record is in no returned field before reveal.
    assert "100 C" not in json.dumps(saved)

    wrong = await p.client.post(path(chat_id, step.id, "attempts"), headers=auth(), json={"selection": "Ice floats."})
    assert wrong.status_code == 200 and wrong.json()["attempts"][-1]["result"] == "not_it"
    missing = await p.client.post(path(chat_id, step.id, "attempts"), headers=auth(), json={"selection": "Lava"})
    assert missing.status_code == 400
    right = await p.client.post(path(chat_id, step.id, "attempts"), headers=auth(), json={"selection": "50 C"})
    assert right.json()["found"] is True and right.json()["quote"] is None
    assert (await p.client.post(path(chat_id, step.id, "reveal"), headers=auth("b"))).status_code == 404

    revealed = (await p.client.post(path(chat_id, step.id, "reveal"), headers=auth())).json()
    assert revealed["revealed"] is True
    assert revealed["quote"] == "It boils at 50 C at sea level."
    assert revealed["correction"] == "It boils at 100 C."
    assert revealed["source"]["name"] == "notes.txt" and revealed["source"]["available"] is True
    assert revealed["source"]["excerpt"] == "Water boils at 100 C at sea level."
    late = await p.client.post(path(chat_id, step.id, "attempts"), headers=auth(), json={"selection": "50 C"})
    assert late.status_code == 409

    # A removed source turns unavailable on read.
    assert (await p.client.delete(f"/files/{notes['filename']}", headers=auth())).status_code in (200, 204)
    body = (await p.client.get(f"/chat/{chat_id}", headers=auth())).json()
    saved = next(m for m in body["messages"] if m["id"] == str(step.id))
    assert saved["exercise"]["source"]["available"] is False


@pytest.mark.asyncio
async def test_an_unusable_record_still_labels_the_answer_as_an_exercise(produced):
    p = produced
    chat_id, request_id, execution = await exercise_run(p)
    step = await save(p, chat_id, request_id, execution, record(quote="Not in the answer."))
    assert step.content == ANSWER
    assert step.exercise is not None and step.exercise.valid is False
    attempt = await p.client.post(path(chat_id, step.id, "attempts"), headers=auth(), json={"selection": "50 C"})
    assert attempt.status_code == 409
    revealed = (await p.client.post(path(chat_id, step.id, "reveal"), headers=auth())).json()
    assert revealed["revealed"] is True and revealed["quote"] is None

    no_block = await save(p, chat_id, step.id, execution, ANSWER)
    assert no_block.exercise is not None and no_block.exercise.valid is False


@pytest.mark.asyncio
async def test_other_modes_are_untouched(produced):
    p = produced
    chat_id, request_id, execution = await exercise_run(p, mode="standard")
    step = await save(p, chat_id, request_id, execution, record())
    assert step.exercise is None and MARKER in step.content
    response = await p.client.post(path(chat_id, step.id, "reveal"), headers=auth())
    assert response.status_code == 400


def test_history_note_marks_exercise_answers():
    assert "deliberate error" in HISTORY_NOTE


@pytest.mark.asyncio
async def test_the_stream_hides_the_record_and_history_marks_the_answer(project_api, monkeypatch):
    from asterism.core.schemas import AuthedUser
    from asterism.domains.agent.agent import Agent
    from asterism.domains.agent.schemas import AgentEvent, AgentEventType
    from asterism.domains.agent.service import get_main_agent_profile
    from asterism.domains.chat.orchestrator import ChatOrchestrator
    from asterism.domains.chat.service import get_one
    from test_chat_comparisons import Runtime, drain

    client, sessions, _ = project_api
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={
            "model_id": "00000000-0000-0000-0000-000000000001",
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Tell me about water",
            "learning_mode": "spot_the_error",
        },
    )
    chat_id = uuid.UUID(response.json()["info"]["id"])
    Runtime(chat_id, sessions, monkeypatch)  # Binds the test session factory.
    async with sessions() as session:
        opened = await get_one(chat_id, "a", session)
        profile = await get_main_agent_profile("a", session)
    agent = Agent(
        profile=profile,
        user=AuthedUser(id="a", name="A", email="a@example.test", role="user"),
        session=opened,
        model_id=opened.info.selected_model_id,
    )
    full = record()
    cuts = [len(ANSWER) + 4, len(ANSWER) + 12, len(full)]

    async def generate(*, messages, replay=None):
        yield AgentEvent(type=AgentEventType.START)
        for cut in cuts:
            yield AgentEvent(type=AgentEventType.DELTA, content=full[:cut])
        yield AgentEvent(type=AgentEventType.COMPLETE, content=full)

    monkeypatch.setattr(agent, "run", generate)
    orchestrator = ChatOrchestrator(agent)
    await orchestrator.resume_pending_turn()

    packets = drain(orchestrator)
    deltas = [packet["content"] for packet in packets if packet["type"] == "delta"]
    assert len(deltas) == 3
    assert all(MARKER[:3] not in delta and "correction" not in delta for delta in deltas)
    complete = next(packet for packet in packets if packet["type"] == "complete")
    answer = complete["last_messages"][-1]
    assert answer["content"] == ANSWER and answer["exercise"]["revealed"] is False
    assert "It boils at 100 C." not in json.dumps(packets)

    history, _ = await orchestrator._assemble_agent_messages()
    assert history[-1].content == ANSWER + HISTORY_NOTE
