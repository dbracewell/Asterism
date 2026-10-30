"""Per-user ChatGPT connection lifecycle and serialized token refresh.

Every operation is scoped to one Asterism user. The OAuth callback is the only
unauthenticated entry point: it derives the user solely from the single-use
authorization attempt matching its ``state``. Refreshes for one user are
serialized in-process, and a refresh only commits over the token revision it
started from, so a rotating refresh token is never used twice or overwritten
by a stale result. No path falls back to another user's connection or to any
other billing source.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass
from enum import StrEnum
from urllib.parse import urlencode, urlsplit

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.config import config
from asterism.core.exceptions import BadDataException
from asterism.db.database import get_async_db_session

from . import policy
from .models import (
    ChatGPTAuthorizationModel,
    ChatGPTConnectionModel,
    ChatGPTConnectionStatus,
    ChatGPTHostModel,
)
from .oauth import (
    ChatGPTIdTokenError,
    ChatGPTOAuthClient,
    ChatGPTOAuthError,
    ChatGPTOAuthUnavailable,
    Pkce,
    TokenSet,
    build_authorize_url,
    digest,
    random_secret,
)
from .schemas import (
    ChatGPTAuthorizationStart,
    ChatGPTCallbackResult,
    ChatGPTConnection,
    ChatGPTDisconnectResult,
)

logger = get_logger("ChatGPTConnection")

CALLBACK_PATH = "/api/py/chatgpt/callback"
AUTHORIZATION_TTL_SECONDS = 600
# Refresh this long before expiry so a request never starts on a dying token.
REFRESH_MARGIN_SECONDS = 300
_REVOKE_ATTEMPTS = 3

_refresh_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
_oauth_client: ChatGPTOAuthClient | None = None


def oauth_client() -> ChatGPTOAuthClient:
    """Process-wide OAuth client (cached discovery and JWKS)."""
    global _oauth_client
    if _oauth_client is None:
        _oauth_client = ChatGPTOAuthClient()
    return _oauth_client


async def close_oauth_client() -> None:
    """App-shutdown hook."""
    global _oauth_client
    if _oauth_client is not None:
        await _oauth_client.aclose()
        _oauth_client = None


class PlanUnavailableReason(StrEnum):
    POLICY_DISABLED = "policy_disabled"
    NOT_CONNECTED = "not_connected"
    PLAN_USAGE_DISABLED = "plan_usage_disabled"
    REAUTHORIZATION_REQUIRED = "reauthorization_required"
    TEMPORARILY_UNAVAILABLE = "temporarily_unavailable"


class ChatGPTPlanUnavailable(Exception):
    """The user's plan cannot serve requests now; ``reason`` says why."""

    def __init__(self, reason: PlanUnavailableReason) -> None:
        super().__init__(f"ChatGPT plan is unavailable: {reason.value}")
        self.reason = reason


@dataclass(frozen=True)
class PlanCredential:
    """A current access token for exactly one user's connection."""

    user_id: str
    access_token: str
    expires_at: int


def callback_redirect_uri() -> str:
    """Loopback redirect URI on the browser-facing port of ``PUBLIC_URL``.

    Only the port may vary between sign-ins, and OpenAI requires the literal
    ``127.0.0.1`` host, so the browser must run on the Asterism machine.
    """
    parsed = urlsplit(config.public_url)
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return f"http://127.0.0.1:{port}{CALLBACK_PATH}"


def settings_redirect_url(result: ChatGPTCallbackResult) -> str:
    """User Settings location that reports the callback outcome."""
    query = urlencode({"t": "user", "setting": "chatgpt", "chatgpt": result.value})
    return f"{config.public_url.rstrip('/')}/settings?{query}"


async def host_id(session: AsyncSession) -> str:
    """Return the installation's stable ``ext_agent_host_id``, creating it once."""
    existing = await session.scalar(select(ChatGPTHostModel.host_id).where(ChatGPTHostModel.id == 1))
    if existing:
        return existing
    await session.execute(
        insert(ChatGPTHostModel)
        .values(id=1, host_id=f"urn:uuid:{uuid.uuid4()}")
        .on_conflict_do_nothing(index_elements=[ChatGPTHostModel.id]),
    )
    await session.commit()
    created = await session.scalar(select(ChatGPTHostModel.host_id).where(ChatGPTHostModel.id == 1))
    assert created is not None
    return created


def _connection_view(row: ChatGPTConnectionModel | None, *, policy_enabled: bool) -> ChatGPTConnection:
    if row is None:
        return ChatGPTConnection(policy_enabled=policy_enabled)
    return ChatGPTConnection(
        policy_enabled=policy_enabled,
        status=row.status,
        email=row.email,
        plan_usage_enabled=row.status == ChatGPTConnectionStatus.CONNECTED,
        updated_at=row.updated_at,
    )


async def get_connection(user_id: str, session: AsyncSession) -> ChatGPTConnection:
    """Return the caller's connection state (never tokens)."""
    enabled = (await policy.read_policy(session)).enabled
    return _connection_view(await session.get(ChatGPTConnectionModel, user_id), policy_enabled=enabled)


async def start_authorization(user_id: str, session: AsyncSession) -> ChatGPTAuthorizationStart:
    """Create a single-use attempt and return the authorize URL for the caller.

    Reauthorizes with the saved issued client ID when the user has one;
    otherwise starts a new dynamic registration. Any earlier pending attempt
    for the user is discarded.
    """
    if not (await policy.read_policy(session)).enabled:
        raise BadDataException("ChatGPT plan connections are disabled by the administrator")
    now = int(time.time())
    connection = await session.get(ChatGPTConnectionModel, user_id)
    host = await host_id(session)
    state, nonce, pkce = random_secret(), random_secret(), Pkce.create()
    redirect_uri = callback_redirect_uri()

    await session.execute(
        delete(ChatGPTAuthorizationModel).where(
            (ChatGPTAuthorizationModel.user_id == user_id) | (ChatGPTAuthorizationModel.expires_at <= now),
        ),
    )
    session.add(
        ChatGPTAuthorizationModel(
            state_digest=digest(state),
            user_id=user_id,
            client_id=connection.client_id if connection else None,
            code_verifier=pkce.verifier,
            nonce=nonce,
            redirect_uri=redirect_uri,
            expires_at=now + AUTHORIZATION_TTL_SECONDS,
        ),
    )
    await session.commit()
    logger.info("ChatGPT authorization started user=%s reauthorization=%s", user_id, connection is not None)
    return ChatGPTAuthorizationStart(
        authorization_url=build_authorize_url(
            client_id=connection.client_id if connection else None,
            host_id=host,
            redirect_uri=redirect_uri,
            state=state,
            nonce=nonce,
            code_challenge=pkce.challenge,
            id_token_hint=connection.id_token if connection else None,
            login_hint=connection.email if connection else None,
        ),
    )


@dataclass(frozen=True)
class CallbackParams:
    state: str | None
    code: str | None
    client_id: str | None
    error: str | None


async def _consume_attempt(state: str, session: AsyncSession) -> ChatGPTAuthorizationModel | None:
    attempt = await session.get(ChatGPTAuthorizationModel, digest(state))
    if attempt is None:
        return None
    await session.delete(attempt)
    await session.commit()
    if attempt.expires_at <= int(time.time()):
        return None
    return attempt


def _token_values(tokens: TokenSet, *, refresh_token: str) -> dict[str, object]:
    return {
        "access_token": tokens.access_token,
        "refresh_token": refresh_token,
        "expires_at": int(time.time()) + tokens.expires_in,
        "scopes": " ".join(sorted(tokens.scopes)),
        "status": (
            ChatGPTConnectionStatus.CONNECTED
            if tokens.plan_usage_granted
            else ChatGPTConnectionStatus.PLAN_USAGE_DISABLED
        ),
    }


async def complete_authorization(
    params: CallbackParams,
    session: AsyncSession,
    oauth: ChatGPTOAuthClient | None = None,
) -> ChatGPTCallbackResult:
    """Finish the attempt identified by ``state``; never raises to the browser.

    The attempt is consumed before anything else, so a replayed callback
    always fails. Declined consent stops before any code exchange.
    """
    oauth = oauth or oauth_client()
    if not params.state:
        return ChatGPTCallbackResult.EXPIRED
    attempt = await _consume_attempt(params.state, session)
    if attempt is None:
        return ChatGPTCallbackResult.EXPIRED
    user_id = attempt.user_id
    if params.error:
        logger.info("ChatGPT authorization declined user=%s error=%s", user_id, params.error)
        return ChatGPTCallbackResult.DENIED
    if not (await policy.read_policy(session)).enabled:
        return ChatGPTCallbackResult.POLICY_DISABLED
    if not params.code:
        return ChatGPTCallbackResult.FAILED

    # Reauthorization keeps the attempt's client ID and rejects a different
    # one; a new registration is incomplete without an issued client ID.
    if attempt.client_id is not None:
        if params.client_id and params.client_id != attempt.client_id:
            return ChatGPTCallbackResult.FAILED
        client_id = attempt.client_id
    elif params.client_id:
        client_id = params.client_id
    else:
        return ChatGPTCallbackResult.FAILED

    try:
        tokens = await oauth.exchange_code(
            client_id=client_id,
            code=params.code,
            code_verifier=attempt.code_verifier,
            redirect_uri=attempt.redirect_uri,
        )
        if tokens.id_token is None or tokens.refresh_token is None:
            raise ChatGPTOAuthError("Token response is missing the ID or refresh token")
        identity = await oauth.validate_id_token(tokens.id_token, client_id=client_id, nonce=attempt.nonce)
    except (ChatGPTOAuthError, ChatGPTOAuthUnavailable, ChatGPTIdTokenError) as error:
        logger.warning("ChatGPT authorization failed user=%s error=%s", user_id, type(error).__name__)
        return ChatGPTCallbackResult.FAILED

    async with _refresh_locks[user_id]:
        connection = await session.get(ChatGPTConnectionModel, user_id)
        if connection is not None and connection.subject != identity.subject:
            return ChatGPTCallbackResult.ACCOUNT_MISMATCH
        values = _token_values(tokens, refresh_token=tokens.refresh_token)
        if connection is None:
            connection = ChatGPTConnectionModel(
                user_id=user_id,
                client_id=client_id,
                host_id=await host_id(session),
                subject=identity.subject,
                email=identity.email,
                id_token=tokens.id_token,
                token_revision=1,
                **values,
            )
            session.add(connection)
        else:
            for key, value in values.items():
                setattr(connection, key, value)
            connection.email = identity.email or connection.email
            connection.id_token = tokens.id_token
            connection.token_revision += 1
        await session.commit()

    logger.info("ChatGPT connection saved user=%s status=%s", user_id, connection.status.value)
    if connection.status == ChatGPTConnectionStatus.CONNECTED:
        return ChatGPTCallbackResult.CONNECTED
    return ChatGPTCallbackResult.PLAN_USAGE_DISABLED


async def disconnect(
    user_id: str,
    session: AsyncSession,
    *,
    forget: bool,
    oauth: ChatGPTOAuthClient | None = None,
) -> ChatGPTDisconnectResult:
    """Revoke (best effort, bounded retries) and remove the caller's tokens.

    The issued client ID and verified identity are kept for a later sign-in
    unless ``forget`` is set, which deletes the registration entirely.
    """
    oauth = oauth or oauth_client()
    confirmed = True
    async with _refresh_locks[user_id]:
        connection = await session.get(ChatGPTConnectionModel, user_id)
        if connection is not None and connection.refresh_token:
            confirmed = False
            for attempt in range(_REVOKE_ATTEMPTS):
                try:
                    confirmed = await oauth.revoke(
                        client_id=connection.client_id, refresh_token=connection.refresh_token
                    )
                    break
                except ChatGPTOAuthUnavailable:
                    if attempt + 1 < _REVOKE_ATTEMPTS:
                        await asyncio.sleep(0.5 * 2**attempt)
        if connection is not None:
            if forget:
                await session.delete(connection)
            else:
                connection.access_token = None
                connection.refresh_token = None
                connection.expires_at = None
                connection.status = ChatGPTConnectionStatus.DISCONNECTED
                connection.token_revision += 1
            await session.commit()
    logger.info("ChatGPT disconnected user=%s forget=%s revocation_confirmed=%s", user_id, forget, confirmed)
    return ChatGPTDisconnectResult(
        revocation_confirmed=confirmed,
        connection=await get_connection(user_id, session),
    )


async def access_token(user_id: str, oauth: ChatGPTOAuthClient | None = None) -> PlanCredential:
    """Return a current access token for ``user_id``'s own connection.

    Refreshes near expiry under the user's lock. Terminal refresh errors clear
    the tokens and require signing in again; temporary failures keep the
    credentials and reuse a still-valid token when there is one.

    Raises:
        ChatGPTPlanUnavailable: With the reason the plan cannot be used.
    """
    oauth = oauth or oauth_client()
    async with _refresh_locks[user_id], get_async_db_session() as session:
        if not (await policy.read_policy(session)).enabled:
            raise ChatGPTPlanUnavailable(PlanUnavailableReason.POLICY_DISABLED)
        connection = await session.get(ChatGPTConnectionModel, user_id)
        if connection is None or connection.status == ChatGPTConnectionStatus.DISCONNECTED:
            raise ChatGPTPlanUnavailable(PlanUnavailableReason.NOT_CONNECTED)
        if connection.status == ChatGPTConnectionStatus.REAUTHORIZATION_REQUIRED:
            raise ChatGPTPlanUnavailable(PlanUnavailableReason.REAUTHORIZATION_REQUIRED)
        if connection.status == ChatGPTConnectionStatus.PLAN_USAGE_DISABLED:
            raise ChatGPTPlanUnavailable(PlanUnavailableReason.PLAN_USAGE_DISABLED)
        assert connection.access_token and connection.refresh_token and connection.expires_at

        now = int(time.time())
        if connection.expires_at - now > REFRESH_MARGIN_SECONDS:
            return PlanCredential(
                user_id=user_id, access_token=connection.access_token, expires_at=connection.expires_at
            )

        revision = connection.token_revision
        try:
            tokens = await oauth.refresh(client_id=connection.client_id, refresh_token=connection.refresh_token)
            if tokens.id_token is not None:
                identity = await oauth.validate_id_token(tokens.id_token, client_id=connection.client_id, nonce=None)
                if identity.subject != connection.subject:
                    raise ChatGPTIdTokenError("Refreshed identity changed")
        except ChatGPTOAuthError as error:
            if not error.terminal_refresh:
                logger.warning("ChatGPT refresh rejected user=%s code=%s", user_id, error.code)
                raise ChatGPTPlanUnavailable(PlanUnavailableReason.TEMPORARILY_UNAVAILABLE) from error
            await _require_reauthorization(session, user_id, revision)
            logger.warning("ChatGPT refresh terminal user=%s code=%s", user_id, error.code)
            raise ChatGPTPlanUnavailable(PlanUnavailableReason.REAUTHORIZATION_REQUIRED) from error
        except ChatGPTIdTokenError as error:
            await _require_reauthorization(session, user_id, revision)
            raise ChatGPTPlanUnavailable(PlanUnavailableReason.REAUTHORIZATION_REQUIRED) from error
        except ChatGPTOAuthUnavailable as error:
            if connection.expires_at > now:
                return PlanCredential(
                    user_id=user_id, access_token=connection.access_token, expires_at=connection.expires_at
                )
            raise ChatGPTPlanUnavailable(PlanUnavailableReason.TEMPORARILY_UNAVAILABLE) from error

        # Replace the access token, expiry, scopes and rotating refresh token
        # together, and only over the token set this refresh started from.
        values = _token_values(tokens, refresh_token=tokens.refresh_token or connection.refresh_token)
        if tokens.id_token is not None:
            values["id_token"] = tokens.id_token
        result = await session.execute(
            update(ChatGPTConnectionModel)
            .where(ChatGPTConnectionModel.user_id == user_id, ChatGPTConnectionModel.token_revision == revision)
            .values(token_revision=revision + 1, updated_at=now, **values),
        )
        await session.commit()
        if getattr(result, "rowcount", 0) != 1:
            raise ChatGPTPlanUnavailable(PlanUnavailableReason.NOT_CONNECTED)
        if values["status"] != ChatGPTConnectionStatus.CONNECTED:
            raise ChatGPTPlanUnavailable(PlanUnavailableReason.PLAN_USAGE_DISABLED)
        return PlanCredential(user_id=user_id, access_token=tokens.access_token, expires_at=int(values["expires_at"]))  # type: ignore[arg-type]


async def _require_reauthorization(session: AsyncSession, user_id: str, revision: int) -> None:
    await session.execute(
        update(ChatGPTConnectionModel)
        .where(ChatGPTConnectionModel.user_id == user_id, ChatGPTConnectionModel.token_revision == revision)
        .values(
            access_token=None,
            refresh_token=None,
            expires_at=None,
            status=ChatGPTConnectionStatus.REAUTHORIZATION_REQUIRED,
            token_revision=revision + 1,
        ),
    )
    await session.commit()
