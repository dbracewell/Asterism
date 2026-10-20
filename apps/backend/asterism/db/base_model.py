"""Declarative base for all ORM models in the application.

Every domain model subclasses :class:`Base`, which gives them a shared
``metadata`` registry (``Base.metadata``) used by ``create_all`` and by
:mod:`asterism.db.model_registry` to collect the full table set.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Common base class for all SQLAlchemy ORM models in the application."""

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}>"
