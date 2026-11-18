"""Run against a built image: python docker/smoke-test.py [image].

Uses disposable containers, volumes, secrets, and accounts. Checks invalid-config
safety, environment/file-secret modes, runtime origins, browser artifacts, auth/JWKS,
persistence, backup and restore, graceful shutdown, and failure supervision.
"""

import base64
import http.client
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
restored_name = f"{name}-restored"
backup_volume = f"{name}-backups"
restored_volume = f"{name}-restored-storage"
secret_volume = f"{name}-secrets"
runtime_secrets = {key: secrets.token_urlsafe(32) for key in ("BETTER_AUTH_SECRET", "SYSTEM_KEY", "ADMIN_PASSPHRASE")}


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
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
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


def exchange(base, public_url, method, path, data=None, headers=None, content_length=None):
    """One request without redirects, cookies or raising on errors: (status, headers, body)."""
    target = urllib.parse.urlsplit(base)
    connection = http.client.HTTPConnection(target.hostname, target.port, timeout=15)
    try:
        body = json.dumps(data).encode() if data is not None else None
        connection.putrequest(method, path, skip_host=True)
        connection.putheader("Host", urllib.parse.urlsplit(public_url).netloc)
        connection.putheader("Origin", public_url)
        for key, value in (headers or {}).items():
            connection.putheader(key, value)
        if body is not None:
            connection.putheader("Content-Type", "application/json")
        length = content_length if content_length is not None else len(body or b"")
        connection.putheader("Content-Length", str(length))
        connection.endheaders(body if content_length is None else None)
        response = connection.getresponse()
        return response.status, response.headers, response.read()
    finally:
        connection.close()


def assert_edge_headers(base, public_url, https):
    """US-86.5: page CSP with a nonce, locked-down API responses, HSTS only under HTTPS."""
    _, page, _ = exchange(base, public_url, "GET", "/sign-in")
    policy = page["Content-Security-Policy"] or ""
    assert "'nonce-" in policy and "'strict-dynamic'" in policy, policy
    assert "frame-ancestors 'none'" in policy, policy
    assert page["X-Content-Type-Options"] == "nosniff"
    _, api, _ = exchange(base, public_url, "GET", "/api/py/openapi.json")
    assert (api["Content-Security-Policy"] or "").startswith("default-src 'none'")
    assert api["X-Frame-Options"] == "DENY" and api["X-Content-Type-Options"] == "nosniff"
    assert len(api.get_all("X-Content-Type-Options")) == 1, "Duplicated API security headers"
    for headers in (page, api):
        assert (headers["Strict-Transport-Security"] is not None) == https, "HSTS must follow PUBLIC_URL"


# Accounts are created with the admin key (or by a signed-in admin, or an invite).
signup_path = "/api/auth/sign-up/email?" + urllib.parse.urlencode({"adminKey": runtime_secrets["ADMIN_PASSPHRASE"]})


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

    for disposable_volume in (volume, second_volume, secret_volume, backup_volume, restored_volume):
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
        *(argument for key, value in runtime_secrets.items() for argument in ("-e", f"{key}={value}")),
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
            *(argument for key, value in rejected_secrets.items() for argument in ("-e", f"{key}={value}")),
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
        ["-v", f"{secret_volume}:/run/secrets:ro", "-v", f"{backup_volume}:/backups"],
    )
    raw, request = client(base, public_url)
    request("/api/py/openapi.json")
    assert_edge_headers(base, public_url, https=False)
    html = raw("/sign-in").decode()
    for source in re.findall(r'<script[^>]+src="([^"]+)"', html):
        asset = raw(source)
        for value in runtime_secrets.values():
            if value.encode() in asset:
                raise RuntimeError("A runtime secret appeared in a browser asset")

    credentials = {"email": "smoke@example.com", "password": secrets.token_urlsafe(18)}
    request(signup_path, {**credentials, "name": "Smoke Test"})
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

    # Back up the running instance, restore into an empty volume, and sign in there (US-86.4).
    written = docker("exec", name, "/app/docker/entrypoint.sh", "backup", "--keep", "3")
    archive = re.search(r"Backup written: (/backups/\S+\.tar\.gz)", written)
    assert archive, written
    archive = archive.group(1)
    assert "restorable" in docker("exec", name, "/app/docker/entrypoint.sh", "verify", archive)
    restore_arguments = [
        "-v",
        f"{backup_volume}:/backups:ro",
        "-v",
        f"{secret_volume}:/run/secrets:ro",
        "-e",
        f"PUBLIC_URL={public_url}",
    ]
    refused = subprocess.run(
        ["docker", "run", "--rm", "-v", f"{volume}:/storage", *restore_arguments, image, "restore", archive],
        text=True,
        capture_output=True,
        timeout=180,  # a restore that fell through to starting the app would never exit
    )
    assert refused.returncode != 0 and "empty storage root" in refused.stderr, refused.stderr
    restored = subprocess.run(
        ["docker", "run", "--rm", "-v", f"{restored_volume}:/storage", *restore_arguments, image, "restore", archive],
        text=True,
        capture_output=True,
        timeout=300,
        check=True,
    ).stdout
    assert "Restore complete" in restored, restored
    assert_no_secret_output(restored)
    restored_base = start_container(
        restored_name, restored_volume, public_url, ["-v", f"{secret_volume}:/run/secrets:ro"]
    )
    _, restored_request = client(restored_base, public_url)
    restored_request("/api/auth/sign-in/email", credentials)
    assert restored_request("/api/auth/jwks") == keys, "Signing keys changed across backup and restore"
    restored_request("/api/py/settings/user", token=restored_request("/api/auth/token")["token"])
    docker("rm", "-f", restored_name)

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
        if b'asterism.serve' in args and b'-m' in args:
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

    # An HTTPS public origin (TLS ends at an outside proxy) and a small upload limit.
    second_public_url = "https://localhost:43210"
    environment_arguments = [
        argument for key, value in runtime_secrets.items() for argument in ("-e", f"{key}={value}")
    ]
    second_base = start_container(
        second_name,
        second_volume,
        second_public_url,
        [
            *environment_arguments,
            "-e",
            "MAX_UPLOAD_FILE_SIZE_BYTES=1048576",
            # Production log profile (US-86.6): JSON lines with request ids.
            "-e",
            "LOG_FORMAT=json",
            # Every peer counts as a trusted proxy here, so X-Forwarded-For names the client.
            "-e",
            "TRUSTED_PROXIES=0.0.0.0/0,::/0",
        ],
    )
    assert_edge_headers(second_base, second_public_url, https=True)
    status, signed_up, _ = exchange(
        second_base,
        second_public_url,
        "POST",
        signup_path,
        {
            "email": "environment@example.com",
            "password": secrets.token_urlsafe(18),
            "name": "Environment Test",
        },
    )
    assert status == 200, status
    # Secure cookies are never sent over plain HTTP, so carry them by hand.
    cookies = signed_up.get_all("Set-Cookie") or []
    assert cookies, "Sign-up set no cookies"
    for cookie in cookies:
        attributes = {part.strip().lower() for part in cookie.split(";")[1:]}
        assert cookie.startswith("__Secure-"), cookie.split("=", 1)[0]
        assert {"secure", "httponly", "samesite=lax"} <= attributes, cookie.split("=", 1)[0]
    session_cookie = "; ".join(cookie.split(";", 1)[0] for cookie in cookies)
    status, _, body = exchange(
        second_base, second_public_url, "GET", "/api/auth/token", headers={"Cookie": session_cookie}
    )
    assert status == 200, status
    second_token = json.loads(body)["token"]
    second_claims = json.loads(base64.urlsafe_b64decode(second_token.split(".")[1] + "=="))
    assert second_claims["iss"] == second_public_url
    assert second_claims["aud"] == second_public_url

    # One upload limit: nginx refuses an oversized request before the backend reads it.
    status, _, body = exchange(
        second_base,
        second_public_url,
        "POST",
        "/api/py/files/",
        headers={"Authorization": f"Bearer {second_token}", "Content-Type": "multipart/form-data; boundary=x"},
        content_length=3 * 1024 * 1024,
    )
    assert status == 413, status
    assert json.loads(body) == {"detail": "The upload is larger than the 1 MB limit."}, body

    # Auth writes are rate limited per trusted client address at the edge.
    def sign_in_from(client_address):
        return exchange(
            second_base,
            second_public_url,
            "POST",
            "/api/auth/sign-in/email",
            {"email": "nobody@example.com", "password": "not-the-password"},
            headers={"X-Forwarded-For": client_address},
        )

    limited = None
    for _ in range(100):
        status, headers, body = sign_in_from("203.0.113.7")
        if status == 429 and headers["Retry-After"] == "60":
            limited = json.loads(body)
            break
    assert limited and limited["detail"].startswith("Too many requests"), "No edge rate limit on sign-in"
    status, _, _ = sign_in_from("203.0.113.8")
    assert status != 429, "The rate limit ignored the trusted client address"
    assert_no_secret_output(docker("logs", second_name))
    # A signed-in backend request logs at INFO (the identity sync), under nginx's request id.
    status, settings_headers, _ = exchange(
        second_base,
        second_public_url,
        "GET",
        "/api/py/settings/user",
        headers={"Authorization": f"Bearer {second_token}"},
    )
    assert status == 200, status
    status, ready_headers, ready_body = exchange(second_base, second_public_url, "GET", "/api/py/health/ready")
    assert status == 200 and json.loads(ready_body)["ready"] is True, ready_body
    request_ids = {ready_headers["X-Request-ID"], settings_headers["X-Request-ID"]}
    json_lines = [
        json.loads(line)
        for line in docker("logs", second_name).splitlines()
        if line.startswith("{") and '"logger"' in line
    ]
    assert json_lines, "LOG_FORMAT=json wrote no JSON log lines"
    assert all({"time", "level", "logger", "request_id", "message"} <= set(line) for line in json_lines)
    assert any(line["request_id"] == settings_headers["X-Request-ID"] for line in json_lines), (
        "The signed-in request's log line did not carry its request id"
    )
    assert all(len(value) == 32 for value in request_ids), request_ids
    print(
        "PASS: validation, env/file secrets, runtime origins, browser boundary, "
        "edge headers, secure cookies, upload and rate limits, "
        "persistence, backup and restore, shutdown, failure supervision"
    )
except Exception:
    for container in (name, second_name, restored_name):
        subprocess.run(["docker", "logs", "--tail", "80", container], check=False)
    raise
finally:
    for container in (name, second_name, restored_name):
        subprocess.run(
            ["docker", "rm", "-f", container],
            check=False,
            stdout=subprocess.DEVNULL,
        )
    subprocess.run(
        ["docker", "volume", "rm", volume, second_volume, secret_volume, backup_volume, restored_volume],
        check=False,
        stdout=subprocess.DEVNULL,
    )
