"""A request id for every HTTP request and WebSocket session (US-86.6).

nginx sends its ``$request_id`` as ``X-Request-ID``; a well-formed incoming
value is kept so the edge log and the backend log share it, otherwise a new one
is made. The id is put in :data:`asterism.common.log.request_id` for the whole
request, so every log line it causes carries it, including tasks it starts
(chat runs, knowledge jobs), which copy the context when created. HTTP
responses echo it in ``X-Request-ID``.
"""

import re
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from asterism.common.log import request_id

HEADER = b"x-request-id"
_VALID = re.compile(rb"[A-Za-z0-9._-]{8,64}")


def _incoming(scope: Scope) -> str | None:
    for name, value in scope.get("headers") or ():
        if name == HEADER and _VALID.fullmatch(value):
            return value.decode("ascii")
    return None


class RequestIdMiddleware:
    """Pure ASGI, so it covers WebSocket sessions as well as HTTP requests."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        value = _incoming(scope) or uuid.uuid4().hex
        token = request_id.set(value)

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [(name, item) for name, item in message.get("headers", []) if name != HEADER]
                message = {**message, "headers": [*headers, (HEADER, value.encode("ascii"))]}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id if scope["type"] == "http" else send)
        finally:
            request_id.reset(token)
