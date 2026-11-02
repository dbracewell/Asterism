"""US-55.3: a bounded disagreement pass over comparison columns and sub-agent outputs."""

import asyncio
import json
import uuid
from types import SimpleNamespace

import pytest
from asterism.domains.chat import disagreements
from asterism.domains.chat.disagreements import parse_disagreements
from asterism.domains.chat.schemas import MessageStatus, NewMessageRequest
from asterism.domains.chat.service import add_message
from asterism.domains.chat.verification import UnreadableReply
from test_chat_comparisons import A, B, Runtime, compare_chat, comparison
from test_inline_file_resolution import accepted_run, delegation
from test_produced_files import produced as _produced
from test_projects_api import auth
from test_projects_api import project_api as _project_api

produced = _produced
project_api = _project_api


class FakeModel:
    def __init__(self):
        self.reply: object = {"disagreements": []}
        self.prompts: list[str] = []

    def client(self, *_args, **_kwargs):
        async def generate(*, messages):
            self.prompts.append(messages[-1].content)
            reply = self.reply
            if callable(reply):
                reply = await reply()
            if isinstance(reply, Exception):
                return SimpleNamespace(exception=reply, content=None)
            content = reply if isinstance(reply, str) else json.dumps(reply)
            return SimpleNamespace(exception=None, content=content, input_tokens=40, output_tokens=12)

        return SimpleNamespace(generate=generate)


@pytest.fixture
def fake_model(monkeypatch):
    model = FakeModel()
    monkeypatch.setattr("asterism.domains.llm.selection.create_llm_client", model.client)
    return model


def position(source, claim):
    return {"source": source, "claim": claim}


def test_parsing_keeps_only_real_multi_source_conflicts():
    raw = json.dumps(
        {
            "disagreements": [
                {"topic": "Boiling point", "positions": [position("S1", "100 C"), position("[S2]", "50 C")]},
                {"topic": "One sided", "positions": [position("S1", "x"), position("S1", "y")]},
                {"topic": "Unknown", "positions": [position("S1", "x"), position("S9", "y")]},
                {"topic": "", "positions": [position("S1", "x"), position("S2", "y")]},
                {"topic": "Second", "positions": [position("S2", "a"), position("S1", "b")]},
                {"topic": "Third", "positions": [position("S1", "a"), position("S2", "b")]},
            ]
        }
    )
    found, more = parse_disagreements(raw, {"S1", "S2"}, 2)
    assert [(d.topic, [p.source for p in d.positions]) for d in found] == [
        ("Boiling point", ["S1", "S2"]),
        ("Second", ["S2", "S1"]),
    ]
    assert more is True
    assert parse_disagreements('{"disagreements": []}', {"S1"}, 2) == ([], False)
    with pytest.raises(UnreadableReply):
        parse_disagreements("They agree.", {"S1"}, 2)


async def answered_comparison(project_api, monkeypatch):
    client, sessions, _ = project_api
    accepted = (await compare_chat(client)).json()
    chat_id = uuid.UUID(accepted["info"]["id"])
    comparison_id = accepted["messages"][0]["comparison_id"]
    await (await Runtime(chat_id, sessions, monkeypatch).build()).resume_pending_turn()
    return client, chat_id, comparison_id


@pytest.mark.asyncio
async def test_comparison_disagreements_link_each_position_to_its_column(project_api, monkeypatch, fake_model):
    client, chat_id, comparison_id = await answered_comparison(project_api, monkeypatch)
    fake_model.reply = {
        "disagreements": [{"topic": "Who answered", "positions": [position("S1", "Model A"), position("S2", "B")]}]
    }
    path = f"/chat/{chat_id}/comparisons/{comparison_id}/disagreements"
    response = await client.post(path, headers=auth(), json={"model_id": A})
    assert response.status_code == 200, response.text
    summary = response.json()

    before = await comparison(client, chat_id, comparison_id)
    columns = before["columns"]
    assert summary["model_id"] == A and summary["created_at"] > 0
    assert summary["sources"] == [
        {
            "key": f"S{index + 1}",
            "kind": "column",
            "label": column["model"]["display_name"] or column["model"]["name"],
            "column_index": index,
            "message_id": column["replies"][-1]["id"],
            "delegation_execution_id": None,
            "truncated": False,
        }
        for index, column in enumerate(columns)
    ]
    assert summary["disagreements"][0]["positions"] == [position("S1", "Model A"), position("S2", "B")]
    assert summary["usage"]["input_tokens"] == 40 and summary["usage"]["truncated"] is False
    # Each answer reaches the model as delimited, labelled text.
    assert f'<answer source="S1">\nAnswer from {A}\n</answer>' in fake_model.prompts[0]
    assert f'<answer source="S2">\nAnswer from {B}\n</answer>' in fake_model.prompts[0]
    # Stored on column 0's turn and returned with the comparison.
    assert columns[0]["request"]["disagreements"] == summary
    # Answers are unchanged.
    assert [column["replies"][-1]["content"] for column in columns] == [f"Answer from {A}", f"Answer from {B}"]


@pytest.mark.asyncio
async def test_comparison_needs_two_answered_columns_and_the_owner(project_api, monkeypatch, fake_model):
    client, _, _ = project_api
    accepted = (await compare_chat(client)).json()
    chat_id, comparison_id = accepted["info"]["id"], accepted["messages"][0]["comparison_id"]
    path = f"/chat/{chat_id}/comparisons/{comparison_id}/disagreements"
    unanswered = await client.post(path, headers=auth(), json={"model_id": A})
    assert unanswered.status_code == 400 and "two columns" in unanswered.text
    assert (await client.post(path, headers=auth("b"), json={"model_id": A})).status_code == 404
    assert fake_model.prompts == []


@pytest.mark.asyncio
async def test_failures_are_bounded_and_keep_the_previous_summary(project_api, monkeypatch, fake_model):
    client, chat_id, comparison_id = await answered_comparison(project_api, monkeypatch)
    path = f"/chat/{chat_id}/comparisons/{comparison_id}/disagreements"
    assert (await client.post(path, headers=auth(), json={"model_id": A})).status_code == 200

    fake_model.reply = "No JSON here."
    assert (await client.post(path, headers=auth(), json={"model_id": A})).status_code == 502
    fake_model.reply = RuntimeError("down")
    assert (await client.post(path, headers=auth(), json={"model_id": A})).status_code == 502

    async def slow():
        await asyncio.sleep(1)
        return {"disagreements": []}

    fake_model.reply = slow
    monkeypatch.setattr(disagreements, "MODEL_CALL_SECONDS", 0.05)
    assert (await client.post(path, headers=auth(), json={"model_id": A})).status_code == 504
    saved = (await comparison(client, chat_id, comparison_id))["columns"][0]["request"]["disagreements"]
    assert saved["disagreements"] == []

    # Long answers are cut to the per-source limit and flagged.
    monkeypatch.setattr(disagreements, "MAX_SOURCE_CHARS", 5)
    fake_model.reply = {"disagreements": []}
    summary = (await client.post(path, headers=auth(), json={"model_id": A})).json()
    assert [source["truncated"] for source in summary["sources"]] == [True, True]
    assert '<answer source="S1">\nAnswe\n</answer>' in fake_model.prompts[-1]


@pytest.mark.asyncio
async def test_sub_agent_disagreements_compare_finished_outputs_only(produced, fake_model):
    p = produced
    chat_id, request_id, execution, _ = await accepted_run(p)
    researcher, critic = uuid.uuid4(), uuid.uuid4()
    records = [
        delegation(execution.id, researcher, "Tides come from the Moon."),
        delegation(execution.id, researcher, "Tides come from the Sun."),
        delegation(execution.id, critic, "Tides come from the wind."),
        delegation(execution.id, critic, "   "),
        delegation(execution.id, critic, "Unfinished").model_copy(update={"status": "error"}),
    ]
    async with p.sessions() as session:
        step = await add_message(
            "a",
            chat_id,
            NewMessageRequest(
                role="assistant",
                content="Summary",
                status=MessageStatus.COMPLETED,
                parent_message_id=request_id,
                execution=execution,
                delegations=records,
                model_id=execution.model.id,
            ),
            session,
        )
    fake_model.reply = {
        "disagreements": [{"topic": "Cause of tides", "positions": [position("S1", "Moon"), position("S3", "Wind")]}]
    }
    path = f"/chat/{chat_id}/messages/{step.id}/disagreements"
    response = await p.client.post(path, headers=auth(), json={"model_id": str(execution.model.id)})
    assert response.status_code == 200, response.text
    summary = response.json()
    assert [(s["key"], s["label"], s["delegation_execution_id"]) for s in summary["sources"]] == [
        ("S1", "Helper (1)", str(records[0].execution_id)),
        ("S2", "Helper (2)", str(records[1].execution_id)),
        ("S3", "Helper (3)", str(records[2].execution_id)),
    ]
    body = (await p.client.get(f"/chat/{chat_id}", headers=auth())).json()
    saved = next(m for m in body["messages"] if m["id"] == str(step.id))
    assert saved["disagreements"] == summary

    # A user turn cannot be compared.
    bad = await p.client.post(
        f"/chat/{chat_id}/messages/{request_id}/disagreements",
        headers=auth(),
        json={"model_id": str(execution.model.id)},
    )
    assert bad.status_code == 400
