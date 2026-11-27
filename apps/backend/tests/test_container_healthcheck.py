"""US-117.3: the container health check never follows a redirect."""

import importlib.util
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "docker" / "healthcheck.py"


def _load():
    spec = importlib.util.spec_from_file_location("container_healthcheck", SCRIPT)
    module = importlib.util.module_from_spec(spec)  # pyright: ignore[reportArgumentType]
    spec.loader.exec_module(module)  # pyright: ignore[reportOptionalMemberAccess]
    return module


def _serve(answers: dict[str, int]):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            status = answers.get(self.path, 404)
            self.send_response(status)
            if status in (301, 302, 307):
                self.send_header("Location", "/api/health")
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


@pytest.mark.parametrize(
    ("answers", "healthy"),
    [
        ({"/sign-in": 200, "/api/py/health/ready": 200, "/api/health": 200}, 0),
        # Following the redirect would reach a 200; the check must not.
        ({"/sign-in": 302, "/api/py/health/ready": 200, "/api/health": 200}, 1),
        ({"/sign-in": 200, "/api/py/health/ready": 503, "/api/health": 200}, 1),
    ],
)
def test_every_path_must_answer_200_itself(answers, healthy, capsys):
    server = _serve(answers)
    try:
        assert _load().check(f"http://127.0.0.1:{server.server_port}") == healthy
    finally:
        server.shutdown()
