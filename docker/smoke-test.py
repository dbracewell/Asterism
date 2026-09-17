"""Run against a built image: python docker/smoke-test.py [image].

Uses disposable containers, volumes, secrets, and accounts. Checks invalid-config
safety, environment/file-secret modes, runtime origins, browser artifacts, auth/JWKS,
persistence, graceful shutdown, and failure supervision.
"""

import base64
import http.cookiejar
import json
import re
import secrets
import subprocess
import sys
import time
import urllib.parse
import urllib.request

image = sys.argv[1] if len(sys.argv) > 1 else "asterism:local"
suffix = secrets.token_hex(4)
name = f"asterism-smoke-{suffix}"
second_name = f"{name}-environment"
volume = f"{name}-storage"
second_volume = f"{name}-environment-storage"
secret_volume = f"{name}-secrets"
runtime_secrets = {
    key: secrets.token_urlsafe(32)
    for key in ("BETTER_AUTH_SECRET", "SYSTEM_KEY", "ADMIN_PASSPHRASE")
}


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def healthy(container):
    for _ in range(120):
        state = json.loads(docker("inspect", container))[0]["State"]
        if not state["Running"]:
            raise RuntimeError(f"{container} exited before becoming healthy")
        if state.get("Health", {}).get("Status") == "healthy":
            return
        time.sleep(2)
    raise TimeoutError(f"{container} did not become healthy")


def start_container(container, storage, public_url, extra_arguments):
    docker(
        "run",
        "-d",
        "--name",
        container,
        "--stop-timeout",
        "30",
        "-p",
        "127.0.0.1::3000",
        "-v",
        f"{storage}:/storage",
        "-e",
        f"PUBLIC_URL={public_url}",
        *extra_arguments,
        image,
    )
    healthy(container)
    port = docker("port", container, "3000/tcp").rsplit(":", 1)[1]
    return f"http://127.0.0.1:{port}"


def client(base, public_url):
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    public_host = urllib.parse.urlsplit(public_url).netloc

    def raw(path, data=None, token=None):
        headers = {"Origin": public_url, "Host": public_host}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(
            base + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers=headers,
        )
        with opener.open(request, timeout=15) as response:
            return response.read()

    def request(path, data=None, token=None):
        return json.loads(raw(path, data, token))

    return raw, request


def assert_no_secret_output(output):
    for value in runtime_secrets.values():
        if value in output:
            raise RuntimeError("A runtime secret was written to process output")


try:
    if not name.startswith("asterism-smoke-"):
        raise RuntimeError("Refusing to use a non-test-owned container name")
    metadata = docker("inspect", image) + docker("history", "--no-trunc", image)
    for former_canary in (
        "build-only-placeholder-not-a-runtime-secret",
        "build-only-placeholder-system-key",
        "build-only-placeholder-admin-passphrase",
    ):
        if former_canary in metadata:
            raise RuntimeError("A build-time secret canary remains in image metadata")
        layer_scan = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--entrypoint",
                "grep",
                image,
                "-R",
                "-F",
                former_canary,
                "/app",
            ],
            capture_output=True,
        )
        if layer_scan.returncode == 0:
            raise RuntimeError("A build-time secret canary remains in image files")
        if layer_scan.returncode not in (0, 1):
            raise RuntimeError("Could not scan image files for secret canaries")
    dotenv_files = docker(
        "run",
        "--rm",
        "--entrypoint",
        "find",
        image,
        "/app",
        "-type",
        "f",
        "-name",
        ".env*",
        "!",
        "-name",
        ".env.example",
        "-print",
    )
    if dotenv_files:
        raise RuntimeError("Runtime dotenv files were copied into the image")

    for disposable_volume in (volume, second_volume, secret_volume):
        docker("volume", "create", disposable_volume)
    docker(
        "run",
        "--rm",
        "--user",
        "root",
        "--entrypoint",
        "sh",
        "-v",
        f"{secret_volume}:/run/secrets",
        *(
            argument
            for key, value in runtime_secrets.items()
            for argument in ("-e", f"{key}={value}")
        ),
        image,
        "-c",
        "for name in BETTER_AUTH_SECRET SYSTEM_KEY ADMIN_PASSPHRASE; do "
        'printenv "$name" > "/run/secrets/$name"; '
        'chmod 0444 "/run/secrets/$name"; done',
    )

    rejected_secrets = {
        "BETTER_AUTH_SECRET": "replace-with-rejected-container-canary",
        "SYSTEM_KEY": secrets.token_urlsafe(32),
        "ADMIN_PASSPHRASE": secrets.token_urlsafe(32),
    }
    rejected = subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "-v",
            f"{volume}:/storage",
            "-e",
            "PUBLIC_URL=http://127.0.0.1:43123",
            *(
                argument
                for key, value in rejected_secrets.items()
                for argument in ("-e", f"{key}={value}")
            ),
            image,
        ],
        text=True,
        capture_output=True,
    )
    rejected_output = rejected.stdout + rejected.stderr
    if rejected.returncode == 0:
        raise RuntimeError("Invalid configuration unexpectedly started")
    for value in rejected_secrets.values():
        if value in rejected_output:
            raise RuntimeError("A rejected secret was written to process output")
    storage_entries = docker(
        "run",
        "--rm",
        "--entrypoint",
        "find",
        "-v",
        f"{volume}:/storage",
        image,
        "/storage",
        "-mindepth",
        "1",
        "-print",
    )
    if storage_entries:
        raise RuntimeError("Invalid configuration mutated storage")

    public_url = "http://127.0.0.1:43123"
    base = start_container(
        name,
        volume,
        public_url,
        ["-v", f"{secret_volume}:/run/secrets:ro"],
    )
    raw, request = client(base, public_url)
    request("/api/py/openapi.json")
    html = raw("/sign-in").decode()
    for source in re.findall(r'<script[^>]+src="([^"]+)"', html):
        asset = raw(source)
        for value in runtime_secrets.values():
            if value.encode() in asset:
                raise RuntimeError("A runtime secret appeared in a browser asset")

    credentials = {"email": "smoke@example.com", "password": secrets.token_urlsafe(18)}
    request("/api/auth/sign-up/email", {**credentials, "name": "Smoke Test"})
    token = request("/api/auth/token")["token"]
    claims = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    assert claims["iss"] == public_url
    assert claims["aud"] == public_url
    request("/api/py/settings/user", token=token)
    keys = request("/api/auth/jwks")

    docker("stop", name)
    assert docker("inspect", "-f", "{{.State.ExitCode}}", name) == "0"
    docker("start", name)
    healthy(name)
    port = docker("port", name, "3000/tcp").rsplit(":", 1)[1]
    base = f"http://127.0.0.1:{port}"
    raw, request = client(base, public_url)
    request("/api/auth/sign-in/email", credentials)
    assert request("/api/auth/jwks") == keys, "Signing keys changed across restart"
    request("/api/py/settings/user", token=request("/api/auth/token")["token"])
    assert_no_secret_output(docker("logs", name))

    docker(
        "exec",
        name,
        "python",
        "-c",
        """
import os, signal
from pathlib import Path
for path in Path('/proc').glob('[0-9]*/cmdline'):
    try:
        args = path.read_bytes().split(b'\\0')
        if any(arg.endswith(b'/uvicorn') for arg in args):
            environment = (path.parent / 'environ').read_bytes().split(b'\\0')
            names = {item.split(b'=', 1)[0] for item in environment if b'=' in item}
            if b'BETTER_AUTH_SECRET' in names or b'ADMIN_PASSPHRASE' in names:
                raise SystemExit('Frontend-only secrets reached the backend')
            if b'SYSTEM_KEY' not in names:
                raise SystemExit('Shared system key did not reach the backend')
            os.kill(int(path.parent.name), signal.SIGTERM)
            break
    except (FileNotFoundError, ProcessLookupError):
        pass
else:
    raise SystemExit('Could not locate backend process')
""",
    )
    for _ in range(40):
        state = json.loads(docker("inspect", name))[0]["State"]
        if not state["Running"]:
            assert state["ExitCode"] != 0, "Service failure was reported as success"
            break
        time.sleep(1)
    else:
        raise AssertionError("Supervisor left container running after service exit")

    second_public_url = "http://localhost:43210"
    environment_arguments = [
        argument
        for key, value in runtime_secrets.items()
        for argument in ("-e", f"{key}={value}")
    ]
    second_base = start_container(
        second_name,
        second_volume,
        second_public_url,
        environment_arguments,
    )
    _, second_request = client(second_base, second_public_url)
    second_request(
        "/api/auth/sign-up/email",
        {
            "email": "environment@example.com",
            "password": secrets.token_urlsafe(18),
            "name": "Environment Test",
        },
    )
    second_token = second_request("/api/auth/token")["token"]
    second_claims = json.loads(
        base64.urlsafe_b64decode(second_token.split(".")[1] + "==")
    )
    assert second_claims["iss"] == second_public_url
    assert second_claims["aud"] == second_public_url
    assert_no_secret_output(docker("logs", second_name))
    print(
        "PASS: validation, env/file secrets, runtime origins, browser boundary, "
        "persistence, shutdown, failure supervision"
    )
except Exception:
    for container in (name, second_name):
        subprocess.run(["docker", "logs", "--tail", "80", container], check=False)
    raise
finally:
    for container in (name, second_name):
        subprocess.run(
            ["docker", "rm", "-f", container],
            check=False,
            stdout=subprocess.DEVNULL,
        )
    subprocess.run(
        ["docker", "volume", "rm", volume, second_volume, secret_volume],
        check=False,
        stdout=subprocess.DEVNULL,
    )
