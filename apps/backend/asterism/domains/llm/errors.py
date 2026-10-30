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
        """Preserve status, code, param and request ID from an SDK error."""
        status = error.status_code if isinstance(error, APIStatusError) else None
        request_id = error.request_id if isinstance(error, APIStatusError) else None
        return cls(
            error.message,
            code=error.code,
            status=status,
            param=error.param,
            request_id=request_id,
        )
