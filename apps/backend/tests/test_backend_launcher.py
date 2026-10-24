"""The supported package/container launcher rejects worker fan-out before startup."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from asterism import serve

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parents[1]


@pytest.mark.parametrize("name", ["WEB_CONCURRENCY", "UVICORN_WORKERS"])
@pytest.mark.parametrize("value", ["2", "0", "-1", "", "01", "do-not-print-worker-value"])
def test_worker_environment_rejected_before_application_import(tmp_path, name, value):
    environment = {k: v for k, v in os.environ.items() if k not in ("WEB_CONCURRENCY", "UVICORN_WORKERS")}
    environment.update({name: value, "STORAGE_ROOT": str(tmp_path / "never-created")})
    result = subprocess.run(
        [sys.executable, "-m", "asterism.serve", "--check"],
        cwd=BACKEND,
        env=environment,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert f"{name} must be unset or 1" in result.stderr
    assert "do-not-print-worker-value" not in result.stderr
    assert not (tmp_path / "never-created").exists()


@pytest.mark.parametrize("arguments", [[], ["--workers", "1"], ["-w", "1"]])
def test_single_worker_launch_is_explicit_and_forwards_supported_options(monkeypatch, arguments):
    monkeypatch.setenv("WEB_CONCURRENCY", "1")
    monkeypatch.setenv("UVICORN_WORKERS", "1")
    calls = []
    monkeypatch.setattr(serve.uvicorn, "run", lambda app, **kwargs: calls.append((app, kwargs)))
    serve.main([*arguments, "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"])
    assert calls == [
        (
            "asterism.main:app",
            {
                "host": "0.0.0.0",
                "port": 8080,
                "workers": 1,
                "timeout_graceful_shutdown": None,
                "proxy_headers": True,
                "forwarded_allow_ips": "127.0.0.1",
            },
        )
    ]


def test_default_launch_uses_one_worker_without_environment_settings(monkeypatch):
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)
    calls = []
    monkeypatch.setattr(serve.uvicorn, "run", lambda app, **kwargs: calls.append(kwargs))
    serve.main([])
    assert calls[0]["workers"] == 1 and calls[0]["port"] == 8000
    assert calls[0]["timeout_graceful_shutdown"] is None and calls[0]["proxy_headers"] is True


@pytest.mark.parametrize("arguments", [["--workers", "2"], ["--workers=2"], ["-w", "2"], ["--reload"]])
def test_unsupported_server_options_cannot_bypass_the_launcher(monkeypatch, arguments):
    monkeypatch.setattr(serve.uvicorn, "run", lambda *args, **kwargs: pytest.fail("server must not start"))
    with pytest.raises(SystemExit) as error:
        serve.main(arguments)
    assert error.value.code == 2


def test_package_and_container_launch_paths_use_the_guard_before_storage_work():
    scripts = json.loads((BACKEND / "package.json").read_text())["scripts"]
    for name in ("dev:raw", "start"):
        assert "python -m asterism.serve" in scripts[name]
        assert "uvicorn asterism.main" not in scripts[name]
    entrypoint = (REPO / "docker" / "entrypoint.sh").read_text()
    assert entrypoint.index("asterism.serve --check") < entrypoint.index("load_secret BETTER_AUTH_SECRET")
    assert entrypoint.index("asterism.serve --check") < entrypoint.index("migrate --config")
    assert ".venv/bin/python -m asterism.serve --host 127.0.0.1" in entrypoint
    assert ".venv/bin/uvicorn" not in entrypoint
