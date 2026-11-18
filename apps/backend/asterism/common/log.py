"""Central logging setup for the Asterism backend (US-86.6).

One stdout handler for every logger, Uvicorn's included. ``LOG_LEVEL`` (default
``INFO``) sets the level; ``LOG_FORMAT`` is ``text`` (default, Uvicorn-style) or
``json`` (one object per line). Every record carries the ``request_id`` of the
HTTP request or WebSocket session it ran under; tasks started there inherit it,
because asyncio copies context variables into new tasks. Uvicorn's transport
loggers get a filter that redacts socket query credentials.

``core.config`` validates both settings at startup. This module reads them from
the environment itself because it is a leaf: it is imported before any config.
"""

import json
import logging
import os
import re
from contextvars import ContextVar
from datetime import UTC, datetime
from logging import Logger
from logging.config import dictConfig
from typing import Any

LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR")
LOG_FORMATS = ("text", "json")

request_id: ContextVar[str | None] = ContextVar("asterism_request_id", default=None)
"""The current request or WebSocket session id; ``None`` outside one (startup, timers)."""


class RedactTransportTokens(logging.Filter):
    """Keep socket query credentials out of Uvicorn transport diagnostics."""

    _token = re.compile(r'([?&](?:token|access_token)=)[^\s&"#]+', re.IGNORECASE)

    @classmethod
    def redact(cls, value):
        """Replace any ``token=``/``access_token=`` query values in *value* with ``[redacted]``.

        Args:
            value: The log text to sanitize; non-string values are returned unchanged.
        """
        return cls._token.sub(r"\1[redacted]", value) if isinstance(value, str) else value

    def filter(self, record: logging.LogRecord) -> bool:
        """Redact credentials in a log record's message and arguments before it is emitted."""
        record.msg = self.redact(record.msg)
        if isinstance(record.args, tuple):
            # Preserve the tuple shape used by Uvicorn's AccessFormatter.
            record.args = tuple(self.redact(value) for value in record.args)
        elif isinstance(record.args, dict):
            record.args = {key: self.redact(value) for key, value in record.args.items()}
        return True


class RequestContext(logging.Filter):
    """Stamp each record with the current request id ("-" outside a request)."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id.get() or "-"
        return True


class JsonFormatter(logging.Formatter):
    """One JSON object per line: time, level, logger, request id, message, and any exception."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "message": record.getMessage(),
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def log_settings(environment: dict[str, str] | None = None) -> tuple[str, str]:
    """The (level, format) the environment asks for, falling back to INFO/text when unset or unknown."""
    source = os.environ if environment is None else environment
    level = source.get("LOG_LEVEL", "INFO").strip().upper()
    fmt = source.get("LOG_FORMAT", "text").strip().lower()
    return (level if level in LOG_LEVELS else "INFO", fmt if fmt in LOG_FORMATS else "text")


def logging_config(level: str = "INFO", fmt: str = "text") -> dict[str, Any]:
    """A ``dictConfig`` payload; also passed to Uvicorn so its own loggers share the handler."""
    formatter = (
        {"()": JsonFormatter}
        if fmt == "json"
        else {
            "()": "uvicorn.logging.DefaultFormatter",
            "fmt": "%(levelprefix)s %(asctime)s | %(name)s | %(request_id)s | %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
            "use_colors": None,
        }
    )
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": {
            "request": {"()": RequestContext},
            "redact": {"()": RedactTransportTokens},
        },
        "formatters": {"default": formatter},
        "handlers": {
            "stream": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "formatter": "default",
                "filters": ["request", "redact"],
            },
        },
        "loggers": {
            "": {"handlers": ["stream"], "level": level},
            "asterism": {"level": level},
            # Uvicorn's loggers go through the same handler (and format).
            "uvicorn": {"handlers": [], "level": level, "propagate": True},
            "uvicorn.error": {"handlers": [], "level": level, "propagate": True, "filters": ["redact"]},
            # Request lines are nginx's job; keep Uvicorn's quiet.
            "uvicorn.access": {"handlers": [], "level": "WARNING", "propagate": True, "filters": ["redact"]},
            "httpx": {"level": "WARNING"},
        },
    }


_is_initialized = False


def __initialize_logging():
    """Apply the environment's logging configuration once."""
    global _is_initialized
    if _is_initialized:
        return
    _is_initialized = True
    dictConfig(logging_config(*log_settings()))


__existing_loggers: dict[str, Logger] = {}


def get_logger(name: str) -> Logger:
    """Return a logger under the given name, initializing logging on first use.

    Loggers inherit ``LOG_LEVEL``; none is pinned to DEBUG.

    Args:
        name: Logger name; typically ``__name__`` of the calling module or a
            dotted namespace such as ``"asterism.agents"``. Loggers are cached by name.

    Returns:
        The (cached) logger instance for *name*.
    """
    __initialize_logging()
    logger = __existing_loggers.get(name, None)
    if logger:
        return logger

    logger = logging.getLogger(name)
    __existing_loggers[name] = logger

    return logger


# Module-level convenience logger for code without a specific namespace.
DEFAULT_LOGGER = get_logger("asterism")
