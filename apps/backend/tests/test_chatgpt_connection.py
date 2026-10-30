"""US-49.2: per-user ChatGPT connection against a local OAuth double."""

import asyncio
import base64
import hashlib
import json
import time
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from asterism.core.exceptions import UnauthorizedException
from asterism.core.schemas import AuthedUser
from asterism.domains.chatgpt import service
from asterism.domains.chatgpt.models import ChatGPTAuthorizationModel, ChatGPTConnectionModel, ChatGPTConnectionStatus
from asterism.domains.chatgpt.oauth import ChatGPTOAuthClient
from asterism.domains.chatgpt.service import ChatGPTPlanUnavailable, PlanUnavailableReason
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import text, update
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
ISSUER = "https://auth.openai.com"
POLICY = "/settings/app/chatgpt"
CALLBACK = "/chatgpt/callback"


class OAuthDouble:
    """Local discovery, JWKS, token and revocation endpoints with signed ID tokens."""

    def __init__(self) -> None:
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.requests: list[tuple[str, dict[str, str]]] = []
        self.subject = "user-sub-1"
        self.email = "plan@example.test"
        self.scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
        self.token_replies: list[httpx.Response] = []
        self.revoke_status = 200
        self.nonce: str | None = None
        self.audience: str | None = None
        self.refresh_count = 0

    def id_token(self, *, audience: str, nonce: str | None) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {
            "iss": ISSUER,
            "aud": audience,
            "sub": self.subject,
            "email": self.email,
            "iat": now,
            "exp": now + 3600,
        }
        if nonce is not None:
            claims["nonce"] = nonce
        return jwt.encode(claims, self.key, algorithm="RS256", headers={"kid": "k1"})

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/.well-known/openid-configuration":
            return httpx.Response(
                200,
                json={"jwks_uri": f"{ISSUER}/jwks", "revocation_endpoint": f"{ISSUER}/oauth/revoke"},
            )
        if path == "/jwks":
            public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
            return httpx.Response(200, json={"keys": [{**public, "kid": "k1", "use": "sig", "alg": "RS256"}]})
        form = {key: values[0] for key, values in parse_qs(request.content.decode()).items()}
        self.requests.append((path, form))
        if path == "/oauth/revoke":
            return httpx.Response(self.revoke_status)
        assert path == "/api/accounts/oauth/token"
        if self.token_replies:
            return self.token_replies.pop(0)
        if form["grant_type"] == "refresh_token":
            self.refresh_count += 1
            return httpx.Response(
                200,
                json={
                    "access_token": f"access-{self.refresh_count + 1}",
                    "refresh_token": f"refresh-{self.refresh_count + 1}",
                    "expires_in": 3600,
                    "scope": self.scope,
                    "token_type": "Bearer",
                },
            )
        return httpx.Response(
            200,
            json={
                "access_token": "access-1",
                "refresh_token": "refresh-1",
                "id_token": self.id_token(audience=self.audience or form["client_id"], nonce=self.nonce),
                "expires_in": 3600,
                "scope": self.scope,
                "token_type": "Bearer",
            },
        )

    def requests_to(self, path: str) -> list[dict[str, str]]:
        return [form for request_path, form in self.requests if request_path == path]


@pytest.fixture
def chatgpt(project_api, monkeypatch):
    client, sessions, _ = project_api

    def verify(token):
        if token not in ("a", "b", "admin"):
            raise UnauthorizedException()
        return AuthedUser(
            id=token, email=f"{token}@example.test", name=token, role="admin" if token == "admin" else "user"
        )

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", verify)
    double = OAuthDouble()
    monkeypatch.setattr(
        service,
        "_oauth_client",
        ChatGPTOAuthClient(http=httpx.AsyncClient(transport=httpx.MockTransport(double.handle))),
    )
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def session_context(session=None):
        async with sessions() as new_session:
            yield new_session

    monkeypatch.setattr("asterism.domains.chatgpt.service.get_async_db_session", session_context)
    monkeypatch.setattr(service, "_refresh_locks", __import__("collections").defaultdict(asyncio.Lock))
    return client, sessions, double


async def enable(client, enabled=True):
    response = await client.put(POLICY, headers=auth("admin"), json={"enabled": enabled})
    assert response.status_code == 200, response.text


async def start(client, user="a") -> dict[str, str]:
    response = await client.post("/chatgpt/connection/authorize", headers=auth(user))
    assert response.status_code == 200, response.text
    url = response.json()["authorization_url"]
    assert url.startswith(f"{ISSUER}/api/accounts/authorize?")
    return {key: values[0] for key, values in parse_qs(urlsplit(url).query).items()}


async def connect(client, double, user="a", client_id="oaiapp_1") -> httpx.Response:
    params = await start(client, user)
    double.nonce = params["nonce"]
    return await client.get(CALLBACK, params={"code": "code-1", "state": params["state"], "client_id": client_id})


def redirect_result(response: httpx.Response) -> str:
    assert response.status_code == 303
    location = urlsplit(response.headers["location"])
    assert f"{location.scheme}://{location.netloc}" == "http://localhost:3000"
    assert location.path == "/settings"
    return parse_qs(location.query)["chatgpt"][0]


@pytest.mark.asyncio
async def test_policy_defaults_disabled_is_admin_only_and_gates_authorization(chatgpt):
    client, _, _ = chatgpt
    assert (await client.get(POLICY, headers=auth("admin"))).json() == {"enabled": False}
    assert (await client.put(POLICY, headers=auth("a"), json={"enabled": True})).status_code == 401
    assert (await client.get("/chatgpt/connection", headers=auth("a"))).json()["policy_enabled"] is False
    assert (await client.post("/chatgpt/connection/authorize", headers=auth("a"))).status_code == 400
    await enable(client)
    assert (await client.get("/chatgpt/connection", headers=auth("a"))).json()["policy_enabled"] is True


@pytest.mark.asyncio
async def test_registration_uses_pkce_loopback_and_stores_encrypted_credentials(chatgpt):
    client, sessions, double = chatgpt
    await enable(client)
    params = await start(client)

    assert params["client_id"] == "dynamic_agent_client"
    assert params["agent_name_hint"] == "Asterism"
    assert params["redirect_uri"] == "http://127.0.0.1:3000/api/py/chatgpt/callback"
    assert params["scope"] == "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
    assert params["resource"] == "https://api.openai.com/v1"
    assert params["code_challenge_method"] == "S256"
    assert params["ext_agent_host_id"].startswith("urn:uuid:")
    assert "id_token_hint" not in params

    double.nonce = params["nonce"]
    response = await client.get(CALLBACK, params={"code": "code-1", "state": params["state"], "client_id": "oaiapp_1"})
    assert redirect_result(response) == "connected"

    exchange = double.requests_to("/api/accounts/oauth/token")[0]
    assert exchange["grant_type"] == "authorization_code"
    assert exchange["client_id"] == "oaiapp_1"
    assert exchange["redirect_uri"] == params["redirect_uri"]
    assert exchange["resource"] == "https://api.openai.com/v1"
    challenge = base64.urlsafe_b64encode(hashlib.sha256(exchange["code_verifier"].encode()).digest()).rstrip(b"=")
    assert challenge.decode() == params["code_challenge"]

    connection = (await client.get("/chatgpt/connection", headers=auth("a"))).json()
    assert connection["status"] == "connected"
    assert connection["email"] == "plan@example.test"
    assert connection["plan_usage_enabled"] is True
    assert "token" not in json.dumps(connection)

    async with sessions() as session:
        raw = (
            await session.execute(
                text(
                    "SELECT client_id, host_id, subject, id_token, access_token, refresh_token FROM chatgpt_connections"
                ),
            )
        ).one()
        assert all(value.startswith("enc:v1:") for value in raw)
        assert (await session.execute(text("SELECT count(*) FROM chatgpt_authorizations"))).scalar() == 0

    credential = await service.access_token("a")
    assert credential.access_token == "access-1"

    # The state is single-use: replaying the callback cannot reconnect.
    replay = await client.get(CALLBACK, params={"code": "code-1", "state": params["state"], "client_id": "oaiapp_1"})
    assert redirect_result(replay) == "expired"
    assert len(double.requests_to("/api/accounts/oauth/token")) == 1


@pytest.mark.asyncio
async def test_expired_unknown_and_declined_callbacks_never_exchange_a_code(chatgpt):
    client, sessions, double = chatgpt
    await enable(client)

    assert redirect_result(await client.get(CALLBACK, params={"code": "x", "state": "unknown"})) == "expired"

    params = await start(client)
    declined = await client.get(CALLBACK, params={"state": params["state"], "error": "access_denied"})
    assert redirect_result(declined) == "denied"

    params = await start(client)
    async with sessions() as session:
        await session.execute(update(ChatGPTAuthorizationModel).values(expires_at=0))
        await session.commit()
    expired = await client.get(CALLBACK, params={"code": "x", "state": params["state"], "client_id": "oaiapp_1"})
    assert redirect_result(expired) == "expired"

    params = await start(client)
    missing_client = await client.get(CALLBACK, params={"code": "x", "state": params["state"]})
    assert redirect_result(missing_client) == "failed"

    assert double.requests_to("/api/accounts/oauth/token") == []
    assert (await client.get("/chatgpt/connection", headers=auth("a"))).json()["status"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("tamper", ["nonce", "audience"])
async def test_invalid_id_token_saves_nothing(chatgpt, tamper):
    client, _, double = chatgpt
    await enable(client)
    params = await start(client)
    double.nonce = "other" if tamper == "nonce" else params["nonce"]
    double.audience = "oaiapp_other" if tamper == "audience" else None

    response = await client.get(CALLBACK, params={"code": "c", "state": params["state"], "client_id": "oaiapp_1"})

    assert redirect_result(response) == "failed"
    assert (await client.get("/chatgpt/connection", headers=auth("a"))).json()["status"] is None


@pytest.mark.asyncio
async def test_declined_plan_scope_keeps_connection_with_plan_usage_disabled(chatgpt):
    client, _, double = chatgpt
    await enable(client)
    double.scope = "openid profile email offline_access"

    assert redirect_result(await connect(client, double)) == "plan_usage_disabled"

    connection = (await client.get("/chatgpt/connection", headers=auth("a"))).json()
    assert (connection["status"], connection["plan_usage_enabled"]) == ("plan_usage_disabled", False)
    with pytest.raises(ChatGPTPlanUnavailable) as error:
        await service.access_token("a")
    assert error.value.reason == PlanUnavailableReason.PLAN_USAGE_DISABLED


@pytest.mark.asyncio
async def test_reauthorization_reuses_issued_client_and_rejects_other_identities(chatgpt):
    client, _, double = chatgpt
    await enable(client)
    await connect(client, double)

    params = await start(client)
    assert params["client_id"] == "oaiapp_1"
    assert params["login_hint"] == "plan@example.test"
    assert params["id_token_hint"]
    assert "agent_name_hint" not in params
    first_host = params["ext_agent_host_id"]

    double.nonce = params["nonce"]
    other_client = await client.get(CALLBACK, params={"code": "c", "state": params["state"], "client_id": "oaiapp_9"})
    assert redirect_result(other_client) == "failed"

    params = await start(client)
    assert params["ext_agent_host_id"] == first_host
    double.nonce = params["nonce"]
    double.subject = "someone-else"
    mismatch = await client.get(CALLBACK, params={"code": "c", "state": params["state"]})
    assert redirect_result(mismatch) == "account_mismatch"
    assert (await service.access_token("a")).access_token == "access-1"


@pytest.mark.asyncio
async def test_connections_are_isolated_per_user(chatgpt):
    client, _, double = chatgpt
    await enable(client)
    await connect(client, double, user="a")

    assert (await client.get("/chatgpt/connection", headers=auth("b"))).json()["status"] is None
    with pytest.raises(ChatGPTPlanUnavailable) as error:
        await service.access_token("b")
    assert error.value.reason == PlanUnavailableReason.NOT_CONNECTED

    # User b registers separately; a's credentials are untouched.
    params_b = await start(client, "b")
    assert params_b["client_id"] == "dynamic_agent_client"
    double.nonce = params_b["nonce"]
    double.subject = "user-sub-b"
    double.token_replies.append(
        httpx.Response(
            200,
            json={
                "access_token": "access-b",
                "refresh_token": "refresh-b",
                "id_token": double.id_token(audience="oaiapp_b", nonce=params_b["nonce"]),
                "expires_in": 3600,
                "scope": double.scope,
            },
        ),
    )
    response = await client.get(CALLBACK, params={"code": "c", "state": params_b["state"], "client_id": "oaiapp_b"})
    assert redirect_result(response) == "connected"
    assert (await service.access_token("a")).access_token == "access-1"
    assert (await service.access_token("b")).access_token == "access-b"

    disconnected = await client.post("/chatgpt/connection/disconnect", headers=auth("b"), json={})
    assert disconnected.status_code == 200
    assert (await service.access_token("a")).access_token == "access-1"


async def expire(sessions, user="a"):
    async with sessions() as session:
        await session.execute(
            update(ChatGPTConnectionModel)
            .where(ChatGPTConnectionModel.user_id == user)
            .values(expires_at=int(time.time()) + 10),
        )
        await session.commit()


@pytest.mark.asyncio
async def test_concurrent_refreshes_are_serialized_and_rotate_the_token_set(chatgpt):
    client, sessions, double = chatgpt
    await enable(client)
    await connect(client, double)
    await expire(sessions)

    credentials = await asyncio.gather(*(service.access_token("a") for _ in range(5)))

    refreshes = double.requests_to("/api/accounts/oauth/token")[1:]
    assert len(refreshes) == 1
    assert refreshes[0] == {
        "grant_type": "refresh_token",
        "client_id": "oaiapp_1",
        "refresh_token": "refresh-1",
        "resource": "https://api.openai.com/v1",
    }
    assert {credential.access_token for credential in credentials} == {"access-2"}

    await expire(sessions)
    assert (await service.access_token("a")).access_token == "access-3"
    assert double.requests_to("/api/accounts/oauth/token")[-1]["refresh_token"] == "refresh-2"
    async with sessions() as session:
        row = await session.get(ChatGPTConnectionModel, "a")
        assert row is not None
        assert (row.refresh_token, row.token_revision) == ("refresh-3", 3)


@pytest.mark.asyncio
@pytest.mark.parametrize("code", ["refresh_token_reused", "invalid_grant", "refresh_token_expired"])
async def test_terminal_refresh_errors_require_signing_in_again(chatgpt, code):
    client, sessions, double = chatgpt
    await enable(client)
    await connect(client, double)
    await expire(sessions)
    double.token_replies.append(httpx.Response(400, json={"error": code}))

    with pytest.raises(ChatGPTPlanUnavailable) as error:
        await service.access_token("a")

    assert error.value.reason == PlanUnavailableReason.REAUTHORIZATION_REQUIRED
    async with sessions() as session:
        row = await session.get(ChatGPTConnectionModel, "a")
        assert row is not None
        assert row.status == ChatGPTConnectionStatus.REAUTHORIZATION_REQUIRED
        assert (row.access_token, row.refresh_token) == (None, None)
        assert row.client_id == "oaiapp_1"
    assert (await start(client))["client_id"] == "oaiapp_1"


@pytest.mark.asyncio
async def test_temporary_refresh_failures_keep_credentials(chatgpt):
    client, sessions, double = chatgpt
    await enable(client)
    await connect(client, double)
    await expire(sessions)
    double.token_replies.append(httpx.Response(503))

    assert (await service.access_token("a")).access_token == "access-1"

    async with sessions() as session:
        await session.execute(update(ChatGPTConnectionModel).values(expires_at=int(time.time()) - 1))
        await session.commit()
    double.token_replies.append(httpx.Response(503))
    with pytest.raises(ChatGPTPlanUnavailable) as error:
        await service.access_token("a")
    assert error.value.reason == PlanUnavailableReason.TEMPORARILY_UNAVAILABLE
    async with sessions() as session:
        row = await session.get(ChatGPTConnectionModel, "a")
        assert row is not None and row.refresh_token == "refresh-1"
        assert row.status == ChatGPTConnectionStatus.CONNECTED


@pytest.mark.asyncio
async def test_disabling_policy_pauses_plan_use_without_deleting_connections(chatgpt):
    client, _, double = chatgpt
    await enable(client)
    await connect(client, double)
    await enable(client, False)

    with pytest.raises(ChatGPTPlanUnavailable) as error:
        await service.access_token("a")
    assert error.value.reason == PlanUnavailableReason.POLICY_DISABLED
    connection = (await client.get("/chatgpt/connection", headers=auth("a"))).json()
    assert (connection["policy_enabled"], connection["status"]) == (False, "connected")

    await enable(client)
    assert (await service.access_token("a")).access_token == "access-1"


@pytest.mark.asyncio
async def test_disconnect_revokes_and_removes_tokens_but_keeps_registration(chatgpt):
    client, sessions, double = chatgpt
    await enable(client)
    await connect(client, double)

    response = await client.post("/chatgpt/connection/disconnect", headers=auth("a"), json={})

    assert response.status_code == 200
    body = response.json()
    assert body["revocation_confirmed"] is True
    assert body["connection"]["status"] == "disconnected"
    assert double.requests_to("/oauth/revoke") == [
        {"token": "refresh-1", "token_type_hint": "refresh_token", "client_id": "oaiapp_1"},
    ]
    with pytest.raises(ChatGPTPlanUnavailable):
        await service.access_token("a")
    async with sessions() as session:
        row = await session.get(ChatGPTConnectionModel, "a")
        assert row is not None and (row.access_token, row.refresh_token) == (None, None)
    assert (await start(client))["client_id"] == "oaiapp_1"


@pytest.mark.asyncio
async def test_unconfirmed_revocation_is_reported_and_forget_removes_registration(chatgpt):
    client, sessions, double = chatgpt
    await enable(client)
    await connect(client, double)
    double.revoke_status = 400

    response = await client.post("/chatgpt/connection/disconnect", headers=auth("a"), json={"forget": True})

    body = response.json()
    assert body["revocation_confirmed"] is False
    assert body["connection"]["status"] is None
    async with sessions() as session:
        assert await session.get(ChatGPTConnectionModel, "a") is None
    assert (await start(client))["client_id"] == "dynamic_agent_client"
