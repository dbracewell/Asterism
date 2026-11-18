"""Check both services through the public proxy without authentication."""

from urllib.request import urlopen

# "/sign-in" is public: "/" redirects signed-out clients to PUBLIC_URL, which the
# container itself may not reach (an HTTPS origin served by an outside proxy).
for path in ("/sign-in", "/api/py/openapi.json", "/api/auth/jwks"):
    with urlopen(f"http://127.0.0.1:3000{path}", timeout=3) as response:
        if response.status != 200:
            raise SystemExit(1)
