import logging
import logging.config
from logging import Logger

_is_initialized = False
LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "uvicorn": {
            "()": "uvicorn.logging.DefaultFormatter",
            "fmt": "%(levelprefix)s %(asctime)s | %(name)s | %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
            "use_colors": False,
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
    if _is_initialized:
        return
    _is_initialized = True
    logging.config.dictConfig(LOGGING_CONFIG)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


__existing_loggers: dict[str, Logger] = {}


def get_logger(name: str) -> Logger:
    __initialize_logging()

    logger = __existing_loggers.get(name, None)
    if logger:
        return logger

    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    __existing_loggers[name] = logger

    return logger
