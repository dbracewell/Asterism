"""Check both services through the public proxy without authentication."""
from urllib.request import urlopen

for path in ("/", "/api/py/openapi.json", "/api/auth/jwks"):
    with urlopen(f"http://127.0.0.1:3000{path}", timeout=3) as response:
        if response.status != 200:
            raise SystemExit(1)
