"""Dialect-aware JSON column types with optional Pydantic (de)serialization.

:func:`jsonb_type` returns a SQLAlchemy *type* (not a column) that stores
JSON using the most capable JSON type of the active dialect:

- SQLite: values are written through SQLite's ``jsonb()`` function and stored
  as binary JSONB blobs, then converted back to text with ``json()`` on read.
  This requires SQLite >= 3.45 (2024-01), which introduced the public
  ``jsonb()``/JSONB storage format.
- PostgreSQL: values are stored in native ``JSONB`` columns.
- Any other dialect falls back to plain :class:`~sqlalchemy.types.JSON` with
  no Pydantic processing.

When a ``model_type`` (a Pydantic model class or a ``TypeAdapter``) is given,
outgoing values are validated/dumped and incoming values are validated into
that type; otherwise raw JSON values pass through untouched.

Corruption policy: stored values that are not valid JSON raise on read in
every dialect (the dialect's JSON decoder rejects them before this package
sees them; empty strings — the legacy "unselected" form value — normalize to
``None``). Fail loudly rather than silently surfacing corrupt data.
"""

from typing import Any, Type

from pydantic import BaseModel, TypeAdapter
from sqlalchemy import JSON, Dialect, func
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
from sqlalchemy.types import TypeDecorator


class PydanticJSONB(TypeDecorator):
    """Shared behavior for the per-dialect JSON column types below.

    Args:
        model_type: Optional Pydantic target — a model class or a
            ``TypeAdapter`` (for non-model types such as ``list[str]``).
            Outgoing values are validated/dumped into it; incoming values are
            validated into it. ``None`` passes raw JSON through untouched.

    Subclasses set the class-level ``impl`` (required by ``TypeDecorator``);
    the SQLite subclass additionally adds the ``jsonb()``/``json()`` expression
    wrappers for the binary JSONB round-trip.

    Corrupt stored values fail loudly on read in every dialect: the underlying
    JSON decoder rejects invalid JSON before this class sees it, and model
    validation raises ``ValidationError`` for well-formed JSON that does not
    match ``model_type``.
    """

    cache_ok = True

    def __init__(
        self,
        model_type: type[BaseModel] | TypeAdapter | None = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._model_type = model_type

    def process_bind_param(self, value: Any, dialect: Dialect) -> Any:
        """Serialize an outgoing Python value to JSON-ready data.

        Pydantic models are dumped directly; values for a ``TypeAdapter``
        target are validated first so bad data fails at write time; anything
        else (dicts, lists, scalars) is passed through as-is.
        """
        if value is None:
            return None

        if isinstance(value, BaseModel):
            return value.model_dump(mode="json")
        if isinstance(self._model_type, TypeAdapter):
            validated = self._model_type.validate_python(value)
            return self._model_type.dump_python(validated, mode="json")

        return value

    def process_result_value(self, value: Any, dialect: Dialect) -> Any:
        """Normalize and validate an incoming stored value into ``_model_type``.

        The underlying JSON type (SQLite's ``JSON`` via the ``json()`` column
        wrapper, PostgreSQL's ``JSONB``) has already decoded the stored text
        into a Python object by the time this runs; malformed stored JSON
        raises in that decoder on every dialect, so corrupt rows fail loudly
        and consistently here. An empty string — the legacy "unselected" form
        value older clients wrote for optional settings — is normalized to
        ``None`` on every dialect.
        """
        if value is None:
            return None

        if value == "":
            return None

        if isinstance(self._model_type, type) and issubclass(
            self._model_type,
            BaseModel,
        ):
            return self._model_type.model_validate(value)
        if isinstance(self._model_type, TypeAdapter):
            return self._model_type.validate_python(value)

        return value

    # NOTE: do not define bind_expression/column_expression on this base class.
    # SQLAlchemy sets ``_has_bind_expression`` from the mere *presence* of the
    # method and then crashes compiling non-SQLite statements that receive a
    # ``None`` return; the wrappers must exist only on the SQLite subclass.


class PydanticSQLiteJSONB(PydanticJSONB):
    """SQLite variant: plain ``JSON`` DDL with the binary JSONB round-trip."""

    impl = JSON

    def bind_expression(self, bindparam):
        """Wrap bound parameters in SQLite's ``jsonb()`` for binary storage."""
        return func.jsonb(bindparam, type_=self)

    def column_expression(self, column):
        """Convert stored SQLite JSONB blobs back to JSON text on read."""
        return func.json(column, type_=self)


class PydanticPGJSONB(PydanticJSONB):
    """PostgreSQL variant: native ``JSONB`` columns, no expression wrapping."""

    impl = PG_JSONB


def jsonb_type(model_type: Type[BaseModel] | TypeAdapter | None = None):
    """Build the cross-dialect JSON column *type* used across all domain models.

    Despite living in a module about columns, this returns a
    :class:`~sqlalchemy.types.TypeEngine` (base ``JSON`` with per-dialect
    variants) to pass to ``mapped_column(...)`` — not a ``Column``.

    Args:
        model_type: Optional Pydantic model class or ``TypeAdapter`` used to
            validate incoming rows and normalize outgoing values. ``None``
            stores/returns raw JSON.
    """
    return (
        JSON()
        .with_variant(PydanticSQLiteJSONB(model_type), "sqlite")
        .with_variant(PydanticPGJSONB(model_type), "postgresql")
    )
