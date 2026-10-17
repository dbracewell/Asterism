import logging
import re
from logging import Logger
from logging.config import dictConfig


class RedactTransportTokens(logging.Filter):
    """Keep socket query credentials out of Uvicorn transport diagnostics."""

    _token = re.compile(r'([?&](?:token|access_token)=)[^\s&"#]+', re.IGNORECASE)

    @classmethod
    def redact(cls, value):
        return cls._token.sub(r"\1[redacted]", value) if isinstance(value, str) else value

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self.redact(record.msg)
        if isinstance(record.args, tuple):
            # Preserve the tuple shape used by Uvicorn's AccessFormatter.
            record.args = tuple(self.redact(value) for value in record.args)
        elif isinstance(record.args, dict):
            record.args = {key: self.redact(value) for key, value in record.args.items()}
        return True


_is_initialized = False
_root_logger: Logger | None = None
LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "uvicorn": {
            "()": "uvicorn.logging.DefaultFormatter",
            "fmt": "%(levelprefix)s %(asctime)s | %(name)s | %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
            "use_colors": True,
        },
    },
    "handlers": {
        "stream": {
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
            "formatter": "uvicorn",
            "level": "DEBUG",
        },
    },
    "loggers": {
        "": {
            "handlers": ["stream"],
            "level": "INFO",
        },
    },
}


def __initialize_logging():
    global _is_initialized
    global _root_logger
    if _is_initialized:
        return
    _is_initialized = True
    dictConfig(LOGGING_CONFIG)
    _root_logger = logging.getLogger("asterism")
    _root_logger.setLevel(logging.DEBUG)
    for name in ("uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).addFilter(RedactTransportTokens())
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


__existing_loggers: dict[str, Logger] = {}


def get_logger(name: str) -> Logger:
    __initialize_logging()
    logger = __existing_loggers.get(name, None)
    if logger:
        return logger

    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    __existing_loggers[name] = logger

    return logger


DEFAULT_LOGGER = get_logger("asterism")
