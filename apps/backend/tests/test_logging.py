"""Production logging (US-86.6): level and format, request ids, and log hygiene."""

import asyncio
import io
import json
import logging
import uuid

import httpx
import pytest
from asterism.common.log import JsonFormatter, RequestContext, log_settings, logging_config, request_id
from asterism.core import config
from asterism.core.request_id import RequestIdMiddleware
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.schemas import AgentEvent, AgentEventType
from fastapi import FastAPI, WebSocket
from starlette.testclient import TestClient
from test_chat_comparisons import Runtime
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api


def test_level_and_format_come_from_the_environment_with_safe_fallbacks():
    assert log_settings({}) == ("INFO", "text")
    assert log_settings({"LOG_LEVEL": "warning", "LOG_FORMAT": "JSON"}) == ("WARNING", "json")
    assert log_settings({"LOG_LEVEL": "loud", "LOG_FORMAT": "xml"}) == ("INFO", "text")
    configured = logging_config("WARNING", "json")
    assert configured["loggers"][""]["level"] == "WARNING"
    assert configured["formatters"]["default"]["()"] is JsonFormatter
    # Uvicorn's loggers share the handler, so the format applies to them too.
    assert configured["loggers"]["uvicorn.error"]["propagate"] is True


def test_no_logger_is_pinned_to_debug():
    from asterism.common.log import get_logger

    assert get_logger("asterism.test-module").level == logging.NOTSET
    assert logging.getLogger("asterism").level <= logging.INFO


def test_json_lines_carry_level_logger_request_id_and_exception():
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RequestContext())
    logger = logging.getLogger("asterism.json-test")
    logger.addHandler(handler)
    logger.propagate = False
    token = request_id.set("req-12345678")
    try:
        logger.warning("Disk %s is low", "storage")
        try:
            raise RuntimeError("boom")
        except RuntimeError:
            logger.exception("Job failed")
    finally:
        request_id.reset(token)
        logger.removeHandler(handler)
        logger.propagate = True
    first, second = (json.loads(line) for line in stream.getvalue().splitlines())
    assert first | {"time": ""} == {
        "time": "",
        "level": "WARNING",
        "logger": "asterism.json-test",
        "request_id": "req-12345678",
        "message": "Disk storage is low",
    }
    assert second["level"] == "ERROR" and "RuntimeError: boom" in second["exception"]


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)
    seen: dict[str, str | None] = {}

    @app.get("/work")
    async def work():
        seen["request"] = request_id.get()

        async def job():
            seen["job"] = request_id.get()

        # A task started in a request (a chat run, a knowledge job) keeps its id.
        await asyncio.create_task(job())
        return {"ok": True}

    @app.websocket("/socket")
    async def socket(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_json({"request_id": request_id.get()})
        await websocket.close()

    app.state.seen = seen
    return app


@pytest.mark.asyncio
async def test_each_request_gets_an_id_that_jobs_inherit_and_responses_echo():
    app = _app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/work")
        generated = response.headers["x-request-id"]
        assert len(generated) == 32
        assert app.state.seen == {"request": generated, "job": generated}
        # nginx's id is kept, so edge and backend lines match; a malformed one is replaced.
        kept = await client.get("/work", headers={"X-Request-ID": "f" * 32})
        assert kept.headers["x-request-id"] == "f" * 32
        replaced = await client.get("/work", headers={"X-Request-ID": "bad id\n"})
        assert replaced.headers["x-request-id"] not in ("bad id\n", "")
    assert request_id.get() is None


def test_a_websocket_session_has_its_own_id():
    with TestClient(_app()).websocket_connect("/socket", headers={"X-Request-ID": "a" * 32}) as socket:
        assert socket.receive_json() == {"request_id": "a" * 32}


# --- Log hygiene ----------------------------------------------------------------------

CANARIES = {
    "prompt": "CANARY-PROMPT-7f3a",
    "reply": "CANARY-REPLY-2b9c",
    "about": "CANARY-ABOUT-5d1e",
    "file": "CANARY-FILE-TEXT-8c4f",
    "token": "tok-CANARY-9a6b",
}


def _logged_text(records: list[logging.LogRecord]) -> str:
    formatter = logging.Formatter("%(name)s %(message)s")
    lines = []
    for record in records:
        lines.append(formatter.format(record))
        lines.append(repr(record.args))
    return "\n".join(lines)


@pytest.mark.asyncio
async def test_no_content_files_about_you_tokens_or_secrets_at_info_and_above(
    project_api, monkeypatch, caplog, tmp_path
):
    """Run a send, a model reply, an About you edit and an upload, and read every INFO+ line."""
    from asterism.domains.files.store import LocalFileStore

    client, sessions, _ = project_api
    store = LocalFileStore(tmp_path / "files")
    monkeypatch.setattr("asterism.domains.files.service.get_file_store", lambda: store)
    monkeypatch.setattr("asterism.domains.files.service.start_ingestion", lambda **_: None)

    def verify(token):
        if token not in ("a", CANARIES["token"]):
            from asterism.core.exceptions import UnauthorizedException

            raise UnauthorizedException()
        return AuthedUser(id="a", email="a@example.test", name="a", role="user")

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", verify)
    secret_headers = {"Authorization": f"Bearer {CANARIES['token']}"}
    caplog.set_level(logging.DEBUG)

    about = (await client.get("/users/me/about", headers=secret_headers)).json()
    saved = await client.put(
        "/users/me/about",
        headers=secret_headers,
        json={"about_md": f"I study tides. {CANARIES['about']}", "expected_revision": about["revision"]},
    )
    assert saved.status_code == 200, saved.text
    uploaded = await client.post(
        "/files/",
        headers=secret_headers,
        files={"files": ("notes.txt", f"Lecture notes {CANARIES['file']}".encode(), "text/plain")},
    )
    assert uploaded.status_code == 201, uploaded.text
    sent = await client.post(
        "/chat/",
        headers=auth(),
        json={"request_id": "a" * 32, "user_prompt": f"Explain {CANARIES['prompt']}", "model_id": str(_model())},
    )
    assert sent.status_code == 200, sent.text

    runtime = Runtime(uuid.UUID(sent.json()["info"]["id"]), sessions, monkeypatch)
    orchestrator = await runtime.build()

    async def reply(*, messages, replay=None):
        yield AgentEvent(type=AgentEventType.START)
        yield AgentEvent(type=AgentEventType.DELTA, content=CANARIES["reply"])
        yield AgentEvent(type=AgentEventType.COMPLETE, content=f"Tides: {CANARIES['reply']}")

    monkeypatch.setattr(orchestrator.agent, "run", reply)
    await orchestrator.resume_pending_turn()

    everything = caplog.records
    assert everything, "the flow logged nothing, so the check would prove nothing"
    shown = _logged_text([record for record in everything if record.levelno >= logging.INFO])
    for name, canary in CANARIES.items():
        assert canary not in shown, f"{name} reached a log line at INFO or above"
    assert config.system_key not in shown


def _model():
    return uuid.UUID(int=1)
