"""Bounded rubric documents: ordered performance levels and criteria with one
descriptor per level.

A rubric is the "rubric" kind of the template domain (US-57.1). It is plain
assessment data that a learner attaches to a Draft feedback turn. Parsing
validates shape and bounds, then the semantic invariants Pydantic cannot
express. Nothing here renders prompts for execution beyond the plain text the
model reads, and nothing grants capabilities.
"""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from asterism.core.exceptions import BadDataException

MAX_RUBRIC_BYTES = 65_536
MAX_RUBRIC_NAME_LENGTH = 80
MAX_RUBRIC_DESCRIPTION_LENGTH = 500
MIN_LEVELS = 2
MAX_LEVELS = 6
MAX_CRITERIA = 12
MAX_LEVEL_LABEL_LENGTH = 40
MAX_CRITERION_LABEL_LENGTH = 80
MAX_CRITERION_DESCRIPTION_LENGTH = 500
MAX_DESCRIPTOR_LENGTH = 1_000

# The feedback reply ends with this fixed section, so no criterion may use it.
OVERALL_HEADING = "Overall"


def _nonblank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


def _one_line(value: str) -> str:
    _nonblank(value)
    if "\n" in value or "\r" in value:
        raise ValueError("must be a single line")
    return value


class RubricCriterion(BaseModel):
    """One assessed aspect; ``descriptors[i]`` describes performance at ``levels[i]``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    label: str = Field(min_length=1, max_length=MAX_CRITERION_LABEL_LENGTH)
    description: str = Field(default="", max_length=MAX_CRITERION_DESCRIPTION_LENGTH)
    descriptors: tuple[Annotated[str, Field(min_length=1, max_length=MAX_DESCRIPTOR_LENGTH)], ...] = Field(
        min_length=MIN_LEVELS, max_length=MAX_LEVELS
    )

    _label_line = field_validator("label")(_one_line)

    @field_validator("descriptors")
    @classmethod
    def _descriptors_nonblank(cls, items: tuple[str, ...]) -> tuple[str, ...]:
        for item in items:
            _nonblank(item)
        return items


class RubricDocument(BaseModel):
    """Canonical rubric; levels are ordered from the highest to the lowest."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1, max_length=MAX_RUBRIC_NAME_LENGTH)
    description: str = Field(min_length=1, max_length=MAX_RUBRIC_DESCRIPTION_LENGTH)
    levels: tuple[Annotated[str, Field(min_length=1, max_length=MAX_LEVEL_LABEL_LENGTH)], ...] = Field(
        min_length=MIN_LEVELS, max_length=MAX_LEVELS
    )
    criteria: tuple[RubricCriterion, ...] = Field(min_length=1, max_length=MAX_CRITERIA)

    _name_line = field_validator("name")(_one_line)
    _description_nonblank = field_validator("description")(_nonblank)

    @field_validator("levels")
    @classmethod
    def _levels_one_line(cls, items: tuple[str, ...]) -> tuple[str, ...]:
        for item in items:
            _one_line(item)
        return items


def _folded(text: str) -> str:
    return " ".join(text.split()).casefold()


def _check_semantics(document: RubricDocument) -> None:
    levels = [_folded(level) for level in document.levels]
    if len(set(levels)) != len(levels):
        raise BadDataException("Rubric level names must be unique")
    labels = [_folded(criterion.label) for criterion in document.criteria]
    if len(set(labels)) != len(labels):
        raise BadDataException("Rubric criterion names must be unique")
    if _folded(OVERALL_HEADING) in labels:
        raise BadDataException(f"'{OVERALL_HEADING}' is reserved for the overall feedback section")
    for criterion in document.criteria:
        if len(criterion.descriptors) != len(document.levels):
            raise BadDataException(f"Criterion '{criterion.label}' needs exactly one descriptor per level")


def _texts(document: RubricDocument):
    yield from (document.name, document.description, *document.levels)
    for criterion in document.criteria:
        yield from (criterion.label, criterion.description, *criterion.descriptors)


def serialize_rubric(document: RubricDocument) -> str:
    return document.model_dump_json()


def parse_rubric(data: object) -> RubricDocument:
    """Validate a decoded rubric (dict or model) and return the canonical model."""
    try:
        document = data if isinstance(data, RubricDocument) else RubricDocument.model_validate(data)
    except ValidationError as exc:
        raise BadDataException(f"Invalid rubric: {exc.errors(include_url=False)[0]['msg']}") from exc
    try:
        size = len(serialize_rubric(document).encode("utf-8"))
    except UnicodeEncodeError as exc:
        raise BadDataException("Rubric must be valid UTF-8") from exc
    if size > MAX_RUBRIC_BYTES:
        raise BadDataException(f"Rubric exceeds {MAX_RUBRIC_BYTES} UTF-8 bytes")
    if any("\x00" in text for text in _texts(document)):
        raise BadDataException("Rubric must not contain null characters")
    _check_semantics(document)
    return document


def parse_rubric_json(source: str) -> RubricDocument:
    """Parse stored canonical JSON, bounding size before decoding."""
    if len(source.encode("utf-8", errors="replace")) > MAX_RUBRIC_BYTES:
        raise BadDataException(f"Rubric exceeds {MAX_RUBRIC_BYTES} UTF-8 bytes")
    try:
        return parse_rubric(RubricDocument.model_validate_json(source))
    except ValidationError as exc:
        raise BadDataException(f"Invalid rubric: {exc.errors(include_url=False)[0]['msg']}") from exc


def render_rubric(document: RubricDocument) -> str:
    """The rubric as the model reads it in the learner's turn.

    Levels are listed highest first, and each criterion lists its descriptors
    in the same order. The text is assessment criteria, not instructions.
    """
    lines = [
        f"### Rubric: {document.name}",
        document.description.strip(),
        "",
        f"Levels, from highest to lowest: {', '.join(document.levels)}.",
    ]
    for criterion in document.criteria:
        lines += ["", f"#### Criterion: {criterion.label}"]
        if criterion.description.strip():
            lines.append(criterion.description.strip())
        lines += [f"- {level}: {text.strip()}" for level, text in zip(document.levels, criterion.descriptors)]
    return "\n".join(lines)
