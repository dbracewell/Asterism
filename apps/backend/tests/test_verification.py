"""US-55.2: the bounded verify pass over one answer, its scope and its stored labels."""

import asyncio
import json
import uuid
from types import SimpleNamespace

import asterism.db.database as database
import pytest
from asterism.domains.chat import verification
from asterism.domains.chat.schemas import MessageStatus, NewMessageRequest
from asterism.domains.chat.service import add_message
from asterism.domains.chat.verification import parse_claims, parse_judgment, plain_answer
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel, KnowledgeExtractionStatus
from asterism.domains.knowledge.vector_store import VectorSearchResult
from asterism.domains.settings.models import ApplicationSettingsModel
from sqlalchemy import delete, select
from test_chat_file_scope import upload
from test_inline_file_resolution import accepted_run
from test_produced_files import produced as _produced
from test_projects_api import auth
from test_projects_api import project_api as _project_api

produced = _produced
project_api = _project_api
MODEL = str(uuid.UUID(int=1))
ANSWER = "The sky is blue. Water boils at 50 C. Mars has two moons."


class FakeVectors:
    """Passages per file; a search returns every passage of the allowed files."""

    def __init__(self):
        self.passages: dict[str, list[str]] = {}
        self.queries: list[tuple[str, list[str]]] = []

    async def search(self, vector, *, user_id, allowed_file_ids, limit):
        self.queries.append((vector, list(allowed_file_ids)))
        return [
            VectorSearchResult(
                id=f"{file_id}-{index}",
                user_id=user_id,
                file_id=file_id,
                artifact_generation=1,
                chunk_ordinal=index,
                kind="text",
                content=text,
                score=0.1,
            )
            for file_id in allowed_file_ids
            for index, text in enumerate(self.passages.get(file_id, []))
        ][:limit]


class FakeEmbeddings:
    async def embed_text(self, texts):
        return [[0.0] for _ in texts]


class FakeModel:
    """Extraction reply, then a judgment per claim chosen by a marker in the prompt."""

    def __init__(self):
        self.claims = json.dumps(
            {
                "claims": [
                    {"claim": "The sky is blue.", "quote": "The sky is blue."},
                    {"claim": "Water boils at 50 C.", "quote": "Water boils at 50 C."},
                    {"claim": "Mars has two moons.", "quote": "not in the answer"},
                ]
            }
        )
        self.judgments: dict[str, object] = {
            "sky": {"label": "supported", "evidence": ["E1"], "explanation": "Stated."},
            "boils": {"label": "contradicted", "evidence": ["E2", "E9"], "explanation": "100 C."},
            "Mars": {"label": "unsupported", "evidence": ["E1"], "explanation": "Not covered."},
        }
        self.prompts: list[str] = []

    def client(self, *_args, **_kwargs):
        async def generate(*, messages):
            prompt = messages[-1].content
            self.prompts.append(prompt)
            if prompt.startswith("<answer>"):
                return SimpleNamespace(exception=None, content=self.claims, input_tokens=10, output_tokens=5)
            for marker, reply in self.judgments.items():
                if f"Claim: {marker}" in prompt or marker in prompt.split("\n")[0]:
                    if callable(reply):
                        reply = await reply()
                    if isinstance(reply, Exception):
                        return SimpleNamespace(exception=reply, content=None)
                    content = reply if isinstance(reply, str) else json.dumps(reply)
                    return SimpleNamespace(exception=None, content=content, input_tokens=3, output_tokens=2)
            return SimpleNamespace(exception=None, content="{}", input_tokens=0, output_tokens=0)

        return SimpleNamespace(generate=generate)


@pytest.fixture
def verify(produced, monkeypatch):
    p = produced
    vectors, model = FakeVectors(), FakeModel()
    monkeypatch.setattr("asterism.domains.chat.retrieval.get_async_db_session", database.get_async_db_session)
    monkeypatch.setattr("asterism.domains.chat.retrieval.vector_store", vectors)
    monkeypatch.setattr("asterism.domains.chat.retrieval.embedding_provider", FakeEmbeddings())
    monkeypatch.setattr("asterism.domains.llm.selection.create_llm_client", model.client)
    return SimpleNamespace(**vars(p), vectors=vectors, model=model)


async def searchable(p, file_id, passages, active=True):
    async with p.sessions() as session:
        await session.execute(
            delete(FileKnowledgeArtifactModel).where(FileKnowledgeArtifactModel.file_id == uuid.UUID(file_id))
        )
        session.add(
            FileKnowledgeArtifactModel(
                user_id="a",
                file_id=uuid.UUID(file_id),
                generation=1,
                processing_profile_generation=1,
                status=KnowledgeExtractionStatus.READY,
                is_current=True,
                searchable=True,
            )
        )
        setting = await session.scalar(
            select(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "active_tools")
        )
        tools = ["search_knowledge"] if active else []
        if setting is None:
            session.add(ApplicationSettingsModel(key="active_tools", value=tools))
        else:
            setting.value = tools
        await session.commit()
    p.vectors.passages[file_id] = passages


async def answered(p, files, content=ANSWER):
    chat_id, request_id, execution, _ = await accepted_run(p, [file["id"] for file in files])
    async with p.sessions() as session:
        step = await add_message(
            "a",
            chat_id,
            NewMessageRequest(
                role="assistant",
                content=content,
                status=MessageStatus.COMPLETED,
                parent_message_id=request_id,
                execution=execution,
                model_id=execution.model.id,
            ),
            session,
        )
    return chat_id, request_id, step


def verify_path(chat_id, message_id):
    return f"/chat/{chat_id}/messages/{message_id}/verify"


def test_plain_answer_and_lenient_parsing():
    key = "0123456789ab"
    text = f"[The sky is blue.](asterism-cite:{key}) See ![chart](asterism-file:{uuid.uuid4()})."
    assert plain_answer(text) == "The sky is blue. See chart."

    raw = 'Sure! ```{"claims": [{"claim": "A"}, {"claim": "a"}, {"claim": "B", "quote": "x"}, 3]}```'
    claims, found = parse_claims(raw, "A then B", 1)
    assert [(c.claim, c.quote) for c in claims] == [("A", None)]
    assert found == 2  # Duplicates and invalid items do not count.

    assert parse_judgment('{"label": "supported", "evidence": ["[E2]", "E2", "E7"]}', 2).evidence == [1]
    assert parse_judgment('{"label": "unsupported", "evidence": ["E1"]}', 2).evidence == []
    for raw in ('{"label": "supported", "evidence": []}', '{"label": "maybe"}', "no json"):
        with pytest.raises(verification.UnreadableReply):
            parse_judgment(raw, 2)


@pytest.mark.asyncio
async def test_verify_labels_claims_with_evidence_and_stores_provenance(verify):
    p = verify
    notes = await upload(p.client, "notes.txt")
    await searchable(p, notes["id"], ["The sky is blue on clear days.", "Water boils at 100 C at sea level."])
    chat_id, _, step = await answered(p, [notes])

    response = await p.client.post(verify_path(chat_id, step.id), headers=auth(), json={"model_id": MODEL})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["model_id"] == MODEL and result["created_at"] > 0
    assert result["file_ids"] == [notes["id"]]
    labels = [(c["claim"], c["label"]) for c in result["claims"]]
    assert labels == [
        ("The sky is blue.", "supported"),
        ("Water boils at 50 C.", "contradicted"),
        ("Mars has two moons.", "unsupported"),
    ]
    sky, boils, mars = result["claims"]
    assert sky["quote"] == "The sky is blue." and mars["quote"] is None
    assert [e["excerpt"] for e in sky["evidence"]] == ["The sky is blue on clear days."]
    assert sky["evidence"][0]["name"] == "notes.txt" and sky["evidence"][0]["available"] is True
    assert [e["excerpt"] for e in boils["evidence"]] == ["Water boils at 100 C at sea level."]
    assert mars["evidence"] == []
    assert result["usage"] == {
        "claims_found": 3,
        "claims_checked": 3,
        "claim_limit": verification.MAX_VERIFY_CLAIMS,
        "claims_truncated": False,
        "answer_truncated": False,
        "timed_out": False,
        "searches": 3,
        "model_calls": 4,
        "input_tokens": 19,
        "output_tokens": 11,
        "duration_ms": result["usage"]["duration_ms"],
    }
    # Passages reach the model only as delimited reference text.
    assert any("<excerpts>\n[E1]\nThe sky is blue" in prompt for prompt in p.model.prompts)

    # Stored on the message; the answer itself is unchanged.
    body = (await p.client.get(f"/chat/{chat_id}", headers=auth())).json()
    saved = next(m for m in body["messages"] if m["id"] == str(step.id))
    assert saved["verification"] == result
    assert saved["content"] == ANSWER


@pytest.mark.asyncio
async def test_scope_can_only_narrow_and_follows_live_access(verify):
    p = verify
    a = await upload(p.client, "a.txt")
    b = await upload(p.client, "b.txt")
    outside = await upload(p.client, "outside.txt")
    for file in (a, b, outside):
        await searchable(p, file["id"], [f"{file['original_name']} says the sky is blue."])
    chat_id, _, step = await answered(p, [a, b])
    path = verify_path(chat_id, step.id)

    widened = await p.client.post(path, headers=auth(), json={"model_id": MODEL, "file_ids": [outside["id"]]})
    assert widened.status_code == 400, widened.text

    narrowed = await p.client.post(path, headers=auth(), json={"model_id": MODEL, "file_ids": [b["id"]]})
    assert narrowed.status_code == 200, narrowed.text
    assert narrowed.json()["file_ids"] == [b["id"]]
    assert all(allowed == [b["id"]] for _, allowed in p.vectors.queries)

    # A deleted source leaves scope: earlier evidence turns unavailable on read.
    assert (await p.client.delete(f"/files/{b['filename']}", headers=auth())).status_code in (200, 204)
    body = (await p.client.get(f"/chat/{chat_id}", headers=auth())).json()
    saved = next(m for m in body["messages"] if m["id"] == str(step.id))["verification"]
    assert [e["available"] for e in saved["claims"][0]["evidence"]] == [False]
    gone = await p.client.post(path, headers=auth(), json={"model_id": MODEL, "file_ids": [b["id"]]})
    assert gone.status_code == 409, gone.text

    # Admin policy applies to the verifier too.
    await searchable(p, a["id"], ["a"], active=False)
    off = await p.client.post(path, headers=auth(), json={"model_id": MODEL})
    assert off.status_code == 409 and "turned off" in off.text


@pytest.mark.asyncio
async def test_only_owned_completed_answers_with_recorded_sources(verify):
    p = verify
    notes = await upload(p.client, "notes.txt")
    await searchable(p, notes["id"], ["text"])
    chat_id, request_id, step = await answered(p, [notes])
    body = {"model_id": MODEL}
    assert (await p.client.post(verify_path(chat_id, request_id), headers=auth(), json=body)).status_code == 400
    assert (await p.client.post(verify_path(chat_id, step.id), headers=auth("b"), json=body)).status_code == 404
    assert (await p.client.post(verify_path(chat_id, uuid.uuid4()), headers=auth(), json=body)).status_code == 404

    # A run with no files has nothing to verify against.
    bare_chat, _, bare = await answered(p, [])
    response = await p.client.post(verify_path(bare_chat, bare.id), headers=auth(), json=body)
    assert response.status_code == 409 and "no recorded sources" in response.text


@pytest.mark.asyncio
async def test_limits_bound_claims_time_and_failures(verify, monkeypatch):
    p = verify
    notes = await upload(p.client, "notes.txt")
    await searchable(p, notes["id"], ["The sky is blue."])
    chat_id, _, step = await answered(p, [notes])
    path = verify_path(chat_id, step.id)

    # Claim count: extra claims are counted but not checked.
    many = [{"claim": f"Claim number {i} about the sky."} for i in range(verification.MAX_VERIFY_CLAIMS + 5)]
    p.model.claims = json.dumps({"claims": many})
    p.model.judgments = {"Claim number": {"label": "supported", "evidence": ["E1"]}}
    result = (await p.client.post(path, headers=auth(), json={"model_id": MODEL})).json()
    assert len(result["claims"]) == verification.MAX_VERIFY_CLAIMS
    assert result["usage"]["claims_found"] == verification.MAX_VERIFY_CLAIMS + 5
    assert result["usage"]["claims_truncated"] is True

    # Per-claim failures are labelled unchecked; the pass still completes.
    async def slow():
        await asyncio.sleep(1)
        return {"label": "supported", "evidence": ["E1"]}

    p.model.claims = json.dumps({"claims": [{"claim": "sky slow"}, {"claim": "sky broken"}, {"claim": "sky odd"}]})
    p.model.judgments = {"sky slow": slow, "sky broken": RuntimeError("down"), "sky odd": "not json"}
    monkeypatch.setattr(verification, "MODEL_CALL_SECONDS", 0.05)
    result = (await p.client.post(path, headers=auth(), json={"model_id": MODEL})).json()
    assert [(c["label"], c["explanation"]) for c in result["claims"]] == [
        ("unchecked", verification.TIME_LIMIT),
        ("unchecked", verification.CHECK_FAILED),
        ("unchecked", verification.UNREADABLE),
    ]
    assert result["usage"]["timed_out"] is True and result["usage"]["claims_checked"] == 0

    # Total time: claims left when the deadline passes are not checked.
    monkeypatch.setattr(verification, "REQUEST_SECONDS", 0.0)
    timed_out = await p.client.post(path, headers=auth(), json={"model_id": MODEL})
    assert timed_out.status_code == 504

    # An unreadable claim list fails the request and keeps the earlier result.
    monkeypatch.setattr(verification, "REQUEST_SECONDS", 60.0)
    p.model.claims = "I cannot help with that."
    failed = await p.client.post(path, headers=auth(), json={"model_id": MODEL})
    assert failed.status_code == 502
    body = (await p.client.get(f"/chat/{chat_id}", headers=auth())).json()
    saved = next(m for m in body["messages"] if m["id"] == str(step.id))["verification"]
    assert [c["claim"] for c in saved["claims"]] == ["sky slow", "sky broken", "sky odd"]


def test_evaluation_fixtures_load_and_score():
    from asterism.domains.chat.verification_eval import (
        extraction_prompt,
        judgment_prompt,
        load_suite,
        score_extraction,
        score_judgment,
    )

    suite = load_suite()
    assert len(suite.extraction) >= 3 and len(suite.judgment) >= 5
    assert {case.label for case in suite.judgment} == {"supported", "unsupported", "contradicted"}

    case = next(c for c in suite.extraction if c.id == "facts-and-opinions")
    good = json.dumps(
        {"claims": [{"claim": "Photosynthesis happens in chloroplasts."}, {"claim": "It stores glucose."}]}
    )
    assert score_extraction(case, good).passed
    bad = score_extraction(case, json.dumps({"claims": [{"claim": "It is beautiful."}]}))
    assert not bad.passed and len(bad.failures) == 3
    assert extraction_prompt(case)[-1]["content"].startswith("<answer>")

    second = next(c for c in suite.judgment if c.id == "support-in-second-excerpt")
    assert score_judgment(second, '{"label": "supported", "evidence": ["E2"]}').passed
    assert not score_judgment(second, '{"label": "supported", "evidence": ["E1"]}').passed
    assert not score_judgment(second, "nope").passed
    assert "[E2]\nWatson and Crick" in judgment_prompt(second)[-1]["content"]
