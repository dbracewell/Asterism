"""Structured provider errors carried on ``LLMEventType.ERROR`` events."""

from __future__ import annotations

from openai import APIError, APIStatusError


class LLMProviderError(Exception):
    """A provider-reported failure with its machine-readable details preserved.

    Fields:
        code: Provider ``error.code`` (e.g. ``subscription_sharing_usage_limit_exceeded``),
            or an Asterism code such as ``stream_interrupted``.
        status: HTTP status when the failure was an HTTP response.
        param: Provider ``error.param`` naming the rejected input, if any.
        request_id: Provider request ID for diagnostics.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status: int | None = None,
        param: str | None = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.param = param
        self.request_id = request_id

    @classmethod
    def from_api_error(cls, error: APIError) -> LLMProviderError:
        """Preserve the provider's message, status, code, param and request ID from an SDK error.

        The SDK reads the message only from an ``{"error": {...}}`` body; for any
        other shape, such as Gemini's ``[{"error": {...}}]`` list, its message is
        just "Error code: 400". The provider's own message is taken from the body
        in either shape, so the person sees why the request was refused.
        """
        status = error.status_code if isinstance(error, APIStatusError) else None
        request_id = error.request_id if isinstance(error, APIStatusError) else None
        detail = _body_error(error.body)
        message = detail.get("message")
        if isinstance(message, str) and message.strip() and message.strip() not in error.message:
            text = f"{error.message}: {message.strip()}" if status else message.strip()
        else:
            text = error.message
        code = error.code or (detail.get("status") if isinstance(detail.get("status"), str) else None)
        return cls(text, code=code, status=status, param=error.param, request_id=request_id)


def _body_error(body: object) -> dict:
    """The error object from a provider's error body: ``{"error": {...}}``, a list of those, or the object itself."""
    if isinstance(body, list):
        body = next((item for item in body if isinstance(item, dict)), None)
    if not isinstance(body, dict):
        return {}
    inner = body.get("error", body)
    return inner if isinstance(inner, dict) else {}
