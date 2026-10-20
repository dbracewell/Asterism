"""Core application wiring for the Asterism backend.

Holds cross-cutting infrastructure that individual domains depend on: runtime
configuration (``config``), JWT authentication (``security``), the event bus
(``events``), shared schemas (``schemas``), exception types (``exceptions``),
and FastAPI startup/shutdown (``lifespan``).
"""

from .config import config

__all__ = ["config"]
