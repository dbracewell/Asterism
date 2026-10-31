"""Bounded prompt-template documents: a typed field schema plus a placeholder body.

The document is plain data. Parsing validates shape and bounds, then checks the
semantic invariants Pydantic cannot express (unique keys, select defaults, and a
one-to-one match between fields and ``{{key}}`` placeholders). Nothing here
renders, executes, or grants capabilities.
"""

import re
from dataclasses import dataclass
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, ValidationError, field_validator

from asterism.core.exceptions import BadDataException

MAX_DOCUMENT_BYTES = 65_536
MAX_NAME_LENGTH = 80
MAX_DESCRIPTION_LENGTH = 500
MAX_BODY_LENGTH = 16_000
MAX_FIELDS = 32
MAX_LABEL_LENGTH = 80
MAX_HELP_LENGTH = 500
MAX_SHORT_TEXT_LENGTH = 500
MAX_LONG_TEXT_LENGTH = 8_000
MAX_SELECT_OPTIONS = 20
MAX_OPTION_LENGTH = 120
MAX_EXAMPLES = 10
MAX_EXAMPLE_LENGTH = 4_000
FIELD_KEY_PATTERN = r"^[a-z][a-z0-9_]{0,31}$"

_KEY = re.compile(r"[a-z][a-z0-9_]{0,31}", re.ASCII)


def _nonblank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


class _FieldBase(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str = Field(pattern=FIELD_KEY_PATTERN)
    label: str = Field(min_length=1, max_length=MAX_LABEL_LENGTH)
    help: str = Field(default="", max_length=MAX_HELP_LENGTH)
    required: StrictBool = False

    _label_nonblank = field_validator("label")(_nonblank)


class ShortTextField(_FieldBase):
    kind: Literal["short_text"]
    default: str | None = Field(default=None, max_length=MAX_SHORT_TEXT_LENGTH)


class LongTextField(_FieldBase):
    kind: Literal["long_text"]
    default: str | None = Field(default=None, max_length=MAX_LONG_TEXT_LENGTH)


class SelectField(_FieldBase):
    kind: Literal["select"]
    options: tuple[Annotated[str, Field(min_length=1, max_length=MAX_OPTION_LENGTH)], ...] = Field(
        min_length=1, max_length=MAX_SELECT_OPTIONS
    )
    default: str | None = Field(default=None, max_length=MAX_OPTION_LENGTH)


class ExamplesField(_FieldBase):
    kind: Literal["examples"]
    default: tuple[Annotated[str, Field(min_length=1, max_length=MAX_EXAMPLE_LENGTH)], ...] | None = Field(
        default=None, max_length=MAX_EXAMPLES
    )


TemplateField = Annotated[
    ShortTextField | LongTextField | SelectField | ExamplesField,
    Field(discriminator="kind"),
]


class TemplateDocument(BaseModel):
    """Canonical template document; clients write it whole, metadata is derived."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    description: str = Field(min_length=1, max_length=MAX_DESCRIPTION_LENGTH)
    fields: tuple[TemplateField, ...] = Field(min_length=1, max_length=MAX_FIELDS)
    body: str = Field(min_length=1, max_length=MAX_BODY_LENGTH)

    _text_nonblank = field_validator("name", "description", "body")(_nonblank)


@dataclass(frozen=True)
class Placeholder:
    key: str


def split_body(body: str) -> list[str | Placeholder]:
    """Split a body into literal text and placeholders.

    Grammar: ``{{key}}`` is a placeholder where key matches FIELD_KEY_PATTERN
    (no inner whitespace). ``\\{{`` is a literal ``{{``. Any other ``{{`` is
    malformed. A lone ``}}`` or ``\\`` is literal.
    """
    segments: list[str | Placeholder] = []
    literal: list[str] = []
    i = 0
    while i < len(body):
        if body.startswith("\\{{", i):
            literal.append("{{")
            i += 3
            continue
        if body.startswith("{{", i):
            match = _KEY.match(body, i + 2)
            if match is None or not body.startswith("}}", match.end()):
                raise BadDataException(f"Malformed placeholder at character {i}; use {{{{key}}}} or \\{{{{")
            if literal:
                segments.append("".join(literal))
                literal = []
            segments.append(Placeholder(match.group()))
            i = match.end() + 2
            continue
        literal.append(body[i])
        i += 1
    if literal:
        segments.append("".join(literal))
    return segments


def _check_semantics(document: TemplateDocument) -> None:
    keys = [field.key for field in document.fields]
    if len(set(keys)) != len(keys):
        raise BadDataException("Template field keys must be unique")
    for field in document.fields:
        if isinstance(field, SelectField):
            if len(set(field.options)) != len(field.options):
                raise BadDataException(f"Select field '{field.key}' has duplicate options")
            if field.default is not None and field.default not in field.options:
                raise BadDataException(f"Select field '{field.key}' default must be one of its options")
    used = {segment.key for segment in split_body(document.body) if isinstance(segment, Placeholder)}
    if unknown := sorted(used - set(keys)):
        raise BadDataException(f"Placeholders without a matching field: {', '.join(unknown)}")
    if unused := [key for key in keys if key not in used]:
        raise BadDataException(f"Fields not used in the body: {', '.join(unused)}")


def parse_document(data: object) -> TemplateDocument:
    """Validate a decoded document (dict or model) and return the canonical model."""
    try:
        document = data if isinstance(data, TemplateDocument) else TemplateDocument.model_validate(data)
    except ValidationError as exc:
        raise BadDataException(f"Invalid template document: {exc.errors(include_url=False)[0]['msg']}") from exc
    try:
        size = len(serialize_document(document).encode("utf-8"))
    except UnicodeEncodeError as exc:
        raise BadDataException("Template document must be valid UTF-8") from exc
    if size > MAX_DOCUMENT_BYTES:
        raise BadDataException(f"Template document exceeds {MAX_DOCUMENT_BYTES} UTF-8 bytes")
    if any("\x00" in text for text in _texts(document)):
        raise BadDataException("Template document must not contain null characters")
    _check_semantics(document)
    return document


def parse_document_json(source: str) -> TemplateDocument:
    """Parse stored canonical JSON, bounding size before decoding."""
    if len(source.encode("utf-8", errors="replace")) > MAX_DOCUMENT_BYTES:
        raise BadDataException(f"Template document exceeds {MAX_DOCUMENT_BYTES} UTF-8 bytes")
    try:
        return parse_document(TemplateDocument.model_validate_json(source))
    except ValidationError as exc:
        raise BadDataException(f"Invalid template document: {exc.errors(include_url=False)[0]['msg']}") from exc


def serialize_document(document: TemplateDocument) -> str:
    return document.model_dump_json(exclude_none=False)


def _texts(document: TemplateDocument):
    yield from (document.name, document.description, document.body)
    for field in document.fields:
        yield from (field.label, field.help)
        if isinstance(field, SelectField):
            yield from field.options
        if isinstance(field.default, str):
            yield field.default
        elif isinstance(field.default, tuple):
            yield from field.default
