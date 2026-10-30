"""OpenAI Sign in with ChatGPT OAuth protocol (authorization code + PKCE).

Pure protocol mechanics with no storage: authorize-URL construction, PKCE and
per-attempt secrets, code exchange, refresh, revocation, and ID-token
validation against the issuer's published JWKS. Callers own persistence and
serialization (see ``service``). Tokens and authorization URLs carrying an
``id_token_hint`` must never be logged.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

AUTH_ISSUER = "https://auth.openai.com"
AUTHORIZE_URL = f"{AUTH_ISSUER}/api/accounts/authorize"
TOKEN_URL = f"{AUTH_ISSUER}/api/accounts/oauth/token"
DISCOVERY_URL = f"{AUTH_ISSUER}/.well-known/openid-configuration"
RESOURCE = "https://api.openai.com/v1"
DYNAMIC_CLIENT_ID = "dynamic_agent_client"
PLAN_USAGE_SCOPE = "chatgpt.tokens.use.direct"
SCOPES = f"openid profile email offline_access resource.invoke {PLAN_USAGE_SCOPE}"
AGENT_NAME = "Asterism"

# Refresh failures after which the refresh token is unusable and the user must
# sign in again with the saved issued client ID.
TERMINAL_REFRESH_ERRORS = frozenset(
    {
        "invalid_grant",
        "invalid_refresh_token",
        "token_expired",
        "refresh_token_expired",
        "refresh_token_invalidated",
        "refresh_token_reused",
    },
)
_JWKS_TTL_SECONDS = 3600
_HTTP_TIMEOUT_SECONDS = 15.0


class ChatGPTOAuthError(Exception):
    """An OAuth endpoint rejected a request (4xx with an error code)."""

    def __init__(self, message: str, *, code: str | None = None, status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status

    @property
    def terminal_refresh(self) -> bool:
        """True when a refresh failed in a way that requires signing in again."""
        return self.code in TERMINAL_REFRESH_ERRORS


class ChatGPTOAuthUnavailable(Exception):
    """The OAuth endpoint was unreachable or failed temporarily (network/5xx)."""


class ChatGPTIdTokenError(Exception):
    """The ID token failed signature, issuer, audience, expiry or nonce checks."""


def random_secret() -> str:
    """Return a fresh URL-safe random value for ``state`` or ``nonce``."""
    return secrets.token_urlsafe(32)


def digest(value: str) -> str:
    """Hex SHA-256 digest used to store ``state`` without the value itself."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Pkce:
    """PKCE verifier and its S256 challenge."""

    verifier: str
    challenge: str

    @classmethod
    def create(cls) -> Pkce:
        verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=")
        return cls(verifier=verifier, challenge=challenge.decode("ascii"))


def build_authorize_url(
    *,
    client_id: str | None,
    host_id: str,
    redirect_uri: str,
    state: str,
    nonce: str,
    code_challenge: str,
    id_token_hint: str | None = None,
    login_hint: str | None = None,
) -> str:
    """Build the authorize URL for registration (``client_id=None``) or reauthorization.

    Registration uses ``dynamic_agent_client`` with ``agent_name_hint``;
    reauthorization uses the issued client ID with the prior ID token and email
    as hints. The returned URL may carry an ID token: do not log it.
    """
    params = {
        "response_type": "code",
        "client_id": client_id or DYNAMIC_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "scope": SCOPES,
        "resource": RESOURCE,
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "ext_agent_host_id": host_id,
    }
    if client_id is None:
        params["agent_name_hint"] = AGENT_NAME
    else:
        if id_token_hint:
            params["id_token_hint"] = id_token_hint
        if login_hint:
            params["login_hint"] = login_hint
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


@dataclass(frozen=True)
class TokenSet:
    """A token-endpoint response. ``scopes`` are the scopes actually granted."""

    access_token: str
    refresh_token: str | None
    id_token: str | None
    expires_in: int
    scopes: frozenset[str]

    @property
    def plan_usage_granted(self) -> bool:
        return PLAN_USAGE_SCOPE in self.scopes


@dataclass(frozen=True)
class Identity:
    """Verified account identity from an ID token."""

    subject: str
    email: str | None


def _error_code(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    if isinstance(error, str):
        return error
    if isinstance(error, dict) and isinstance(error.get("code"), str):
        return error["code"]
    code = payload.get("code")
    return code if isinstance(code, str) else None


def _parse_token_set(payload: Any) -> TokenSet:
    if not isinstance(payload, dict) or not isinstance(payload.get("access_token"), str):
        raise ChatGPTOAuthError("Token response has no access token")
    expires_in = payload.get("expires_in")
    scope = payload.get("scope")
    refresh_token = payload.get("refresh_token")
    id_token = payload.get("id_token")
    return TokenSet(
        access_token=payload["access_token"],
        refresh_token=refresh_token if isinstance(refresh_token, str) else None,
        id_token=id_token if isinstance(id_token, str) else None,
        expires_in=expires_in if isinstance(expires_in, int) and expires_in > 0 else 3600,
        # Fail closed: an absent scope grants nothing, including plan usage.
        scopes=frozenset(scope.split()) if isinstance(scope, str) else frozenset(),
    )


class ChatGPTOAuthClient:
    """HTTP client for OpenAI's OAuth endpoints, with cached discovery and JWKS.

    Args:
        http: Optional ``httpx.AsyncClient`` (tests inject a local double).
    """

    def __init__(self, http: httpx.AsyncClient | None = None) -> None:
        self._http = http or httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS, follow_redirects=False)
        self._discovery: dict[str, Any] | None = None
        self._jwks: jwt.PyJWKSet | None = None
        self._jwks_fetched_at = 0.0

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _post_form(self, url: str, data: dict[str, str]) -> httpx.Response:
        try:
            response = await self._http.post(url, data=data, headers={"Accept": "application/json"})
        except httpx.HTTPError as error:
            raise ChatGPTOAuthUnavailable("OAuth endpoint is unreachable") from error
        if response.status_code >= 500 or response.status_code == 429:
            raise ChatGPTOAuthUnavailable(f"OAuth endpoint failed with HTTP {response.status_code}")
        return response

    async def _token_request(self, data: dict[str, str]) -> TokenSet:
        response = await self._post_form(TOKEN_URL, data)
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if response.status_code != 200:
            code = _error_code(payload)
            raise ChatGPTOAuthError(
                f"Token request was rejected ({code or response.status_code})",
                code=code,
                status=response.status_code,
            )
        return _parse_token_set(payload)

    async def exchange_code(self, *, client_id: str, code: str, code_verifier: str, redirect_uri: str) -> TokenSet:
        """Exchange an authorization code for tokens with the issued client ID."""
        return await self._token_request(
            {
                "grant_type": "authorization_code",
                "client_id": client_id,
                "code": code,
                "code_verifier": code_verifier,
                "redirect_uri": redirect_uri,
                "resource": RESOURCE,
            },
        )

    async def refresh(self, *, client_id: str, refresh_token: str) -> TokenSet:
        """Rotate the refresh token. ``scope`` is omitted as the docs require."""
        return await self._token_request(
            {
                "grant_type": "refresh_token",
                "client_id": client_id,
                "refresh_token": refresh_token,
                "resource": RESOURCE,
            },
        )

    async def _openid_configuration(self) -> dict[str, Any]:
        if self._discovery is None:
            try:
                response = await self._http.get(DISCOVERY_URL)
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as error:
                raise ChatGPTOAuthUnavailable("OpenID configuration is unavailable") from error
            if not isinstance(payload, dict):
                raise ChatGPTOAuthUnavailable("OpenID configuration is malformed")
            self._discovery = payload
        return self._discovery

    async def revoke(self, *, client_id: str, refresh_token: str) -> bool:
        """End the renewable session. True only on a confirmed (HTTP 200) revocation."""
        configuration = await self._openid_configuration()
        endpoint = configuration.get("revocation_endpoint")
        if not isinstance(endpoint, str):
            return False
        response = await self._post_form(
            endpoint,
            {"token": refresh_token, "token_type_hint": "refresh_token", "client_id": client_id},
        )
        return response.status_code == 200

    async def _signing_key(self, kid: str | None) -> jwt.PyJWK:
        stale = time.monotonic() - self._jwks_fetched_at > _JWKS_TTL_SECONDS
        for attempt in range(2):
            if self._jwks is None or stale or attempt == 1:
                configuration = await self._openid_configuration()
                jwks_uri = configuration.get("jwks_uri")
                if not isinstance(jwks_uri, str):
                    raise ChatGPTOAuthUnavailable("OpenID configuration has no jwks_uri")
                try:
                    response = await self._http.get(jwks_uri)
                    response.raise_for_status()
                    self._jwks = jwt.PyJWKSet.from_dict(response.json())
                except (httpx.HTTPError, ValueError, jwt.PyJWKSetError) as error:
                    raise ChatGPTOAuthUnavailable("Signing keys are unavailable") from error
                self._jwks_fetched_at = time.monotonic()
            for key in self._jwks.keys:
                if kid is None or key.key_id == kid:
                    return key
        raise ChatGPTIdTokenError("ID token signing key is unknown")

    async def validate_id_token(self, id_token: str, *, client_id: str, nonce: str | None) -> Identity:
        """Verify signature, issuer, audience (issued client ID), expiry and nonce.

        ``nonce`` is checked when given (sign-in); refreshed ID tokens are
        validated without it.
        """
        try:
            header = jwt.get_unverified_header(id_token)
        except jwt.PyJWTError as error:
            raise ChatGPTIdTokenError("ID token is malformed") from error
        key = await self._signing_key(header.get("kid"))
        try:
            claims = jwt.decode(
                id_token,
                key.key,
                algorithms=["RS256", "ES256"],
                audience=client_id,
                issuer=AUTH_ISSUER,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
        except jwt.PyJWTError as error:
            raise ChatGPTIdTokenError("ID token failed validation") from error
        if nonce is not None:
            token_nonce = claims.get("nonce")
            if not isinstance(token_nonce, str) or not hmac.compare_digest(token_nonce, nonce):
                raise ChatGPTIdTokenError("ID token nonce does not match")
        subject = claims["sub"]
        if not isinstance(subject, str) or not subject:
            raise ChatGPTIdTokenError("ID token has no subject")
        email = claims.get("email")
        return Identity(subject=subject, email=email if isinstance(email, str) else None)
