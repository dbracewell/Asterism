"""Run against a built image: python docker/smoke-test.py [image].

Uses a disposable container/volume and account; never targets an existing install.
Checks proxy routing, auth/JWKS, persistent sign-in, and graceful shutdown.
"""
import base64
import http.cookiejar
import json
import secrets
import subprocess
import sys
import time
import urllib.request

image = sys.argv[1] if len(sys.argv) > 1 else "asterism:local"
name = f"asterism-smoke-{secrets.token_hex(4)}"
volume = f"{name}-storage"
# Deliberately unresolvable: internal requests must never use the public hostname.
public_url = "http://asterism.invalid"


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def healthy():
    for _ in range(120):
        state = json.loads(docker("inspect", name))[0]["State"]
        if not state["Running"]:
            raise RuntimeError("Container exited before becoming healthy")
        if state.get("Health", {}).get("Status") == "healthy":
            return
        time.sleep(2)
    raise TimeoutError("Container did not become healthy")


try:
    docker("volume", "create", volume)
    # Host port is random to avoid conflicting with an existing installation.
    docker(
        "run", "-d", "--name", name, "--stop-timeout", "30",
        "-p", "127.0.0.1::3000", "-v", f"{volume}:/storage",
        "-e", f"PUBLIC_URL={public_url}",
        "-e", f"BETTER_AUTH_SECRET={secrets.token_urlsafe(32)}",
        "-e", f"SYSTEM_KEY={secrets.token_urlsafe(32)}",
        "-e", f"ADMIN_PASSPHRASE={secrets.token_urlsafe(32)}", image,
    )
    healthy()
    port = docker("port", name, "3000/tcp").rsplit(":", 1)[1]
    base = f"http://127.0.0.1:{port}"
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )

    def request(path, data=None, token=None):
        headers = {"Origin": public_url, "Host": "asterism.invalid"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(
            base + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers=headers,
        )
        with opener.open(req, timeout=15) as response:
            return json.load(response)

    request("/api/py/openapi.json")
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
    healthy()
    port = docker("port", name, "3000/tcp").rsplit(":", 1)[1]
    base = f"http://127.0.0.1:{port}"
    request("/api/auth/sign-in/email", credentials)
    assert request("/api/auth/jwks") == keys, "Signing keys changed across restart"
    request("/api/py/settings/user", token=request("/api/auth/token")["token"])
    # Simulate one service exiting: the supervisor must stop its siblings and
    # return nonzero rather than leave a partially functional container alive.
    docker("exec", name, "python", "-c", """
import os, signal
from pathlib import Path
for path in Path('/proc').glob('[0-9]*/cmdline'):
    try:
        args = path.read_bytes().split(b'\\0')
        if any(arg.endswith(b'/uvicorn') for arg in args):
            os.kill(int(path.parent.name), signal.SIGTERM)
            break
    except (FileNotFoundError, ProcessLookupError):
        pass
else:
    raise SystemExit('Could not locate backend process')
""")
    for _ in range(40):
        state = json.loads(docker("inspect", name))[0]["State"]
        if not state["Running"]:
            assert state["ExitCode"] != 0, "Service failure was reported as success"
            break
        time.sleep(1)
    else:
        raise AssertionError("Supervisor left container running after service exit")
    print("PASS: routing, JWT validation, persistence, shutdown, failure supervision")
except Exception:
    subprocess.run(["docker", "logs", "--tail", "80", name], check=False)
    raise
finally:
    subprocess.run(["docker", "rm", "-f", name], check=False, stdout=subprocess.DEVNULL)
    subprocess.run(["docker", "volume", "rm", volume], check=False, stdout=subprocess.DEVNULL)
