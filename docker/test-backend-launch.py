"""Test the real entrypoint/launcher worker guard in a minimal disposable Linux image.

This exercises worker validation before application dependencies, secrets or data
initialization. It does not substitute for the full application smoke test.
"""

import json
import shutil
import subprocess
import tempfile
import tomllib
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    lock = tomllib.loads((ROOT / "apps/backend/uv.lock").read_text())
    version = next(package["version"] for package in lock["package"] if package["name"] == "uvicorn")
    image = f"asterism-launch-contract-{uuid.uuid4().hex}"
    checks = []

    def run(arguments):
        return subprocess.run(["docker", *arguments], capture_output=True, text=True)

    def check(name, arguments, code, message):
        result = run(["run", "--rm", "--network", "none", *arguments])
        output = result.stdout + result.stderr
        assert result.returncode == code, (name, result.returncode, output)
        assert message in output, (name, output)
        assert "synthetic-worker-canary" not in output
        checks.append(name)
        return output

    try:
        with tempfile.TemporaryDirectory(prefix="asterism-launch-contract-") as directory:
            context = Path(directory)
            for source in (
                "apps/backend/asterism/serve.py",
                "apps/backend/asterism/__init__.py",
                "docker/entrypoint.sh",
            ):
                shutil.copyfile(ROOT / source, context / Path(source).name)
            (context / "Dockerfile").write_text(
                "FROM python:3.13-slim-trixie\n"
                "RUN python -m venv /app/apps/backend/.venv && "
                f"/app/apps/backend/.venv/bin/pip install --no-cache-dir uvicorn=={version}\n"
                "COPY serve.py __init__.py /app/apps/backend/asterism/\n"
                "COPY entrypoint.sh /app/docker/entrypoint.sh\n"
                "WORKDIR /app/apps/backend\n"
                'ENTRYPOINT ["/bin/bash", "/app/docker/entrypoint.sh"]\n'
            )
            built = run(["build", "-t", image, str(context)])
            assert built.returncode == 0, built.stdout + built.stderr
        python = ["--entrypoint", "/app/apps/backend/.venv/bin/python"]
        check("default single worker", [*python, image, "-m", "asterism.serve", "--check"], 0, "one worker")
        check(
            "explicit single worker",
            [
                "-e",
                "WEB_CONCURRENCY=1",
                "-e",
                "UVICORN_WORKERS=1",
                *python,
                image,
                "-m",
                "asterism.serve",
                "--workers",
                "1",
                "--check",
            ],
            0,
            "one worker",
        )
        output = check("entrypoint validates default before secrets", [image], 1, "Set a persistent BETTER_AUTH_SECRET")
        assert "one worker" in output and "Validating configuration" not in output
        for name in ("WEB_CONCURRENCY", "UVICORN_WORKERS"):
            for value in ("2", "0", "synthetic-worker-canary"):
                output = check(
                    f"entrypoint rejects {name}={value}",
                    ["-e", f"{name}={value}", image],
                    2,
                    f"{name} must be unset or 1",
                )
                assert "Set a persistent" not in output and "Validating configuration" not in output
        check(
            "CLI rejects multiple workers",
            [*python, image, "-m", "asterism.serve", "--workers", "2"],
            2,
            "invalid choice",
        )
        print(
            json.dumps({"checks_passed": len(checks), "uvicorn": version, "scope": "worker guard before app startup"})
        )
    finally:
        run(["image", "rm", "-f", image])


if __name__ == "__main__":
    main()
