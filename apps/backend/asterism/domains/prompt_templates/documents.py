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
MAX_HINT_LENGTH = 500
MAX_CHECKLIST_ITEMS = 12
MAX_CHECKLIST_ITEM_LENGTH = 200
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
    # Guided-level hint only; never inserted into the prompt.
    example: str | None = Field(default=None, min_length=1, max_length=MAX_HINT_LENGTH)

    _label_nonblank = field_validator("label")(_nonblank)

    @field_validator("example")
    @classmethod
    def _example_nonblank(cls, value: str | None) -> str | None:
        return None if value is None else _nonblank(value)


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
    # Freeform-level checklist; empty means clients derive it from the fields.
    checklist: tuple[Annotated[str, Field(min_length=1, max_length=MAX_CHECKLIST_ITEM_LENGTH)], ...] = Field(
        default=(), max_length=MAX_CHECKLIST_ITEMS
    )

    _text_nonblank = field_validator("name", "description", "body")(_nonblank)

    @field_validator("checklist")
    @classmethod
    def _checklist_nonblank(cls, items: tuple[str, ...]) -> tuple[str, ...]:
        for item in items:
            _nonblank(item)
        return items


@dataclass(frozen=True)
class Placeholder:
    key: str


@dataclass(frozen=True)
class Section:
    """Text kept only when the field ``key`` has a value: ``{{#key}}...{{/key}}``."""

    key: str
    segments: tuple["str | Placeholder", ...]


def _tag(body: str, i: int) -> tuple[str, str, int]:
    """Read the tag at ``body[i:]`` (which starts with ``{{``): (sigil, key, end)."""
    start = i + 2
    sigil = body[start] if start < len(body) and body[start] in "#/" else ""
    match = _KEY.match(body, start + len(sigil))
    if match is None or not body.startswith("}}", match.end()):
        raise BadDataException(
            f"Malformed placeholder at character {i}; use {{{{key}}}}, {{{{#key}}}}...{{{{/key}}}} or \\{{{{"
        )
    return sigil, match.group(), match.end() + 2


def split_body(body: str) -> list["str | Placeholder | Section"]:
    """Split a body into literal text, placeholders and conditional sections.

    Grammar: ``{{key}}`` is a placeholder where key matches FIELD_KEY_PATTERN
    (no inner whitespace). ``{{#key}}`` opens a section closed by ``{{/key}}``;
    sections do not nest. ``\\{{`` is a literal ``{{``. Any other ``{{`` is
    malformed. A lone ``}}`` or ``\\`` is literal.
    """
    segments: list[str | Placeholder | Section] = []
    current: list[str | Placeholder] = []
    open_key: str | None = None
    open_at = 0
    literal: list[str] = []

    def flush() -> None:
        if literal:
            current.append("".join(literal))
            literal.clear()

    i = 0
    while i < len(body):
        if body.startswith("\\{{", i):
            literal.append("{{")
            i += 3
            continue
        if not body.startswith("{{", i):
            literal.append(body[i])
            i += 1
            continue
        sigil, key, end = _tag(body, i)
        flush()
        if sigil == "":
            current.append(Placeholder(key))
        elif sigil == "#":
            if open_key is not None:
                raise BadDataException(f"Sections cannot nest: '{key}' opens inside '{open_key}' at character {i}")
            segments.extend(current)
            current = []
            open_key, open_at = key, i
        else:
            if open_key != key:
                raise BadDataException(f"Section close '{key}' at character {i} has no matching open")
            segments.append(Section(key, tuple(current)))
            current = []
            open_key = None
        i = end
    flush()
    if open_key is not None:
        raise BadDataException(f"Section '{open_key}' opened at character {open_at} is never closed")
    segments.extend(current)
    return segments


def _placeholder_keys(segments: list["str | Placeholder | Section"]) -> set[str]:
    keys: set[str] = set()
    for segment in segments:
        if isinstance(segment, Placeholder):
            keys.add(segment.key)
        elif isinstance(segment, Section):
            keys.update(child.key for child in segment.segments if isinstance(child, Placeholder))
    return keys


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
    segments = split_body(document.body)
    used = _placeholder_keys(segments)
    if unknown := sorted(used - set(keys)):
        raise BadDataException(f"Placeholders without a matching field: {', '.join(unknown)}")
    sections = {segment.key for segment in segments if isinstance(segment, Section)}
    if unknown := sorted(sections - set(keys)):
        raise BadDataException(f"Sections without a matching field: {', '.join(unknown)}")
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
    yield from document.checklist
    for field in document.fields:
        yield from (field.label, field.help)
        if field.example is not None:
            yield field.example
        if isinstance(field, SelectField):
            yield from field.options
        if isinstance(field.default, str):
            yield field.default
        elif isinstance(field.default, tuple):
            yield from field.default
