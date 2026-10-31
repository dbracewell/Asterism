"""API payloads for the ChatGPT plan policy and per-user connection. Never carries tokens."""

from enum import StrEnum

from pydantic import BaseModel, StrictBool

from .models import ChatGPTConnectionStatus


class ChatGPTPolicy(BaseModel):
    """Admin policy: whether users may connect and use their ChatGPT plans."""

    enabled: StrictBool


class ChatGPTConnection(BaseModel):
    """The caller's connection state.

    Fields:
        policy_enabled: Current admin policy; when false, plan requests are
            unavailable but the connection is kept.
        status: Connection lifecycle state; ``None`` when never connected.
        email: Email from the validated ID token, for display.
        plan_usage_enabled: True only when connected with plan usage granted.
        model_count: Plan models currently listed by the account.
        usage_paused: Plan requests are paused after a usage limit.
        notice_pending: The one-time plan-usage notice has not been dismissed.
        updated_at: Last connection change (Unix seconds).
    """

    policy_enabled: bool
    status: ChatGPTConnectionStatus | None = None
    email: str | None = None
    plan_usage_enabled: bool = False
    model_count: int = 0
    usage_paused: bool = False
    notice_pending: bool = False
    updated_at: int | None = None


class ChatGPTAuthorizationStart(BaseModel):
    """Where the user's browser goes next to continue with ChatGPT."""

    authorization_url: str


class ChatGPTDisconnect(BaseModel):
    """Disconnect options. ``forget`` also removes the saved registration so the
    next sign-in can choose a different ChatGPT account."""

    forget: StrictBool = False


class ChatGPTDisconnectResult(BaseModel):
    """Result of a disconnect; ``revocation_confirmed`` is false when the session
    could not be ended at OpenAI and the user should disconnect it in ChatGPT."""

    revocation_confirmed: bool
    connection: ChatGPTConnection


class ChatGPTCallbackResult(StrEnum):
    """Outcome reported back to User Settings after the OAuth callback."""

    CONNECTED = "connected"
    PLAN_USAGE_DISABLED = "plan_usage_disabled"
    DENIED = "denied"
    EXPIRED = "expired"
    ACCOUNT_MISMATCH = "account_mismatch"
    POLICY_DISABLED = "policy_disabled"
    FAILED = "failed"
