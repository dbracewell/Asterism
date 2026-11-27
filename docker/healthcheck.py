"""Check readiness through the public proxy without authentication (US-86.6).

The backend's readiness covers its database, storage free space and loading
the auth signing keys; the frontend's covers the auth database and signing a
token. "/sign-in" checks that pages render.

Redirects are not followed (US-117.3): each path must answer 200 itself, so a
redirect to a login page or another host never counts as healthy.
"""

import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, build_opener

# "/sign-in" is public: "/" redirects signed-out clients to PUBLIC_URL, which the
# container itself may not reach (an HTTPS origin served by an outside proxy).
PATHS = ("/sign-in", "/api/py/health/ready", "/api/health")


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201
        return None  # urllib then raises HTTPError for the 3xx itself


def check(base: str = "http://127.0.0.1:3000") -> int:
    """0 when every path answers 200, else 1 with the failing answer printed."""
    opener = build_opener(_NoRedirects)
    for path in PATHS:
        try:
            with opener.open(f"{base}{path}", timeout=3) as response:
                if response.status != 200:
                    print(f"{path}: {response.status}")
                    return 1
        except HTTPError as error:
            # 503 carries which check failed; show it in `docker inspect` health logs.
            print(f"{path}: {error.code} {error.read(500).decode(errors='replace')}")
            return 1
        except URLError as error:
            print(f"{path}: {error.reason}")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(check())
