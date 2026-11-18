"""Check readiness through the public proxy without authentication (US-86.6).

The backend's readiness covers its database, storage free space and loading
the auth signing keys; the frontend's covers the auth database and signing a
token. "/sign-in" checks that pages render.
"""

from urllib.error import HTTPError
from urllib.request import urlopen

# "/sign-in" is public: "/" redirects signed-out clients to PUBLIC_URL, which the
# container itself may not reach (an HTTPS origin served by an outside proxy).
for path in ("/sign-in", "/api/py/health/ready", "/api/health"):
    try:
        with urlopen(f"http://127.0.0.1:3000{path}", timeout=3) as response:
            if response.status != 200:
                raise SystemExit(1)
    except HTTPError as error:
        # 503 carries which check failed; show it in `docker inspect` health logs.
        print(f"{path}: {error.code} {error.read(500).decode(errors='replace')}")
        raise SystemExit(1) from None
