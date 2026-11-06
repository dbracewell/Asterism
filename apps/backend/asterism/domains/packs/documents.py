"""Bounded team-pack manifests: inert, versioned data shared between users.

A pack describes sub-agents, skills, prompt templates, rubrics and project
settings. Parsing bounds the raw bytes, decodes strictly, screens every key and
string for credential shapes, then validates shape and semantics. Everything in
a pack is untrusted text or a request: nothing here creates records, selects a
model, or grants a capability. Error messages never quote pack values.
"""

import json
import re
from collections.abc import Callable, Iterable
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, ValidationError, field_validator

from asterism.core.exceptions import BadDataException
from asterism.domains.agent.schemas import GenerationDefaults
from asterism.domains.projects.schemas import MAX_GOAL_CHARS, ProjectAccent, ProjectName
from asterism.domains.prompt_templates.documents import TemplateDocument, parse_document
from asterism.domains.prompt_templates.rubrics import RubricDocument, parse_rubric
from asterism.domains.skills.documents import MAX_DOCUMENT_BYTES as MAX_SKILL_BYTES
from asterism.domains.skills.documents import parse_document as parse_skill
from asterism.domains.tools.catalog import INTERNAL_TOOL_NAMES

PACK_FORMAT = "asterism.team-pack"
PACK_FORMAT_VERSION = 1
PACK_SCHEMA_ID = "https://asterism.local/schemas/team-pack-v1.schema.json"

MAX_PACK_BYTES = 1_048_576
MAX_PACK_DEPTH = 12
MAX_SUB_AGENTS = 16
MAX_SKILLS = 32
MAX_TEMPLATES = 32
MAX_RUBRICS = 16
MAX_REQUESTED_TOOLS = 32
MAX_PACK_ID_LENGTH = 100
MAX_PACK_NAME_LENGTH = 120
MAX_PACK_DESCRIPTION_LENGTH = 2_000
MAX_AUTHOR_LENGTH = 200
MAX_AGENT_NAME_LENGTH = 200
MAX_AGENT_DESCRIPTION_LENGTH = 10_000
MAX_INSTRUCTIONS_LENGTH = 100_000
MAX_CONTEXT_WINDOW = 100_000_000
MAX_ERROR_PATH_LENGTH = 120

ITEM_KEY_PATTERN = r"^[a-z][a-z0-9_-]{0,63}$"
PACK_ID_PATTERN = r"^[a-z0-9]+(?:[.-][a-z0-9]+)*$"
PACK_VERSION_PATTERN = r"^(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})$"
TOOL_NAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$"

ItemKey = Annotated[str, Field(pattern=ITEM_KEY_PATTERN)]
ToolName = Annotated[str, Field(pattern=TOOL_NAME_PATTERN)]

# Compact (lowercase, separators removed) field names that always name a secret.
_CREDENTIAL_NAME_PARTS = (
    "accesskey",
    "apikey",
    "authorization",
    "bearer",
    "cookie",
    "credential",
    "passphrase",
    "passwd",
    "password",
    "privatekey",
    "secret",
)
_NAME_WORD = re.compile(r"[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])")
# High-confidence formats only, so instructions may still discuss credentials.
# Repeats that can restart at every word boundary are capped: packs are untrusted
# and an unbounded repeat here is quadratic in the pack size.
_CREDENTIAL_VALUE = re.compile(
    r"-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----"
    r"|\bsk-[A-Za-z0-9_-]{20,}"
    r"|\bgh[pousr]_[A-Za-z0-9]{36,}"
    r"|\bgithub_pat_[A-Za-z0-9_]{22,}"
    r"|\bAKIA[0-9A-Z]{16}\b"
    r"|\bxox[abprs]-[A-Za-z0-9-]{10,}"
    r"|\bAIza[0-9A-Za-z_-]{35}"
    r"|\bBearer\s+[A-Za-z0-9._~+/-]{20,}"
    r"|\beyJ[A-Za-z0-9_-]{10,200}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
    r"|\b[A-Za-z][A-Za-z0-9+.-]{0,30}://[^\s/:@]{1,256}:[^\s/@]{1,256}@"
)


def one_line(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    if "\n" in value or "\r" in value:
        raise ValueError("must be a single line")
    return value


class _PackModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PackIdentity(_PackModel):
    """Stable identity and version, recorded as provenance on imported items."""

    id: str = Field(max_length=MAX_PACK_ID_LENGTH, pattern=PACK_ID_PATTERN)
    version: str = Field(pattern=PACK_VERSION_PATTERN)
    name: str = Field(min_length=1, max_length=MAX_PACK_NAME_LENGTH)
    description: str = Field(default="", max_length=MAX_PACK_DESCRIPTION_LENGTH)
    author: str = Field(default="", max_length=MAX_AUTHOR_LENGTH)

    _name_line = field_validator("name")(one_line)


class ModelRequirements(_PackModel):
    """What a sub-agent's model must support; the importer picks the model."""

    tools: StrictBool = False
    vision: StrictBool = False
    min_context_window: int | None = Field(default=None, ge=1, le=MAX_CONTEXT_WINDOW)


class PackSubAgent(_PackModel):
    """A sub-agent definition without a model binding or any granted tools."""

    key: ItemKey
    name: str = Field(min_length=1, max_length=MAX_AGENT_NAME_LENGTH)
    description: str = Field(default="", max_length=MAX_AGENT_DESCRIPTION_LENGTH)
    instructions: str = Field(default="", max_length=MAX_INSTRUCTIONS_LENGTH)
    max_steps: int = Field(default=5, ge=1, le=100)
    generation: GenerationDefaults = Field(default_factory=GenerationDefaults)
    requested_tools: tuple[ToolName, ...] = Field(default=(), max_length=MAX_REQUESTED_TOOLS)
    model_requirements: ModelRequirements = Field(default_factory=ModelRequirements)

    _name_line = field_validator("name")(one_line)


class PackSkill(_PackModel):
    """A SKILL.md document; name and description derive from its frontmatter."""

    key: ItemKey
    content: str = Field(min_length=1, max_length=MAX_SKILL_BYTES)
    request_main_agent_assignment: StrictBool = False


class PackTemplate(_PackModel):
    key: ItemKey
    document: TemplateDocument


class PackRubric(_PackModel):
    key: ItemKey
    document: RubricDocument


class PackProject(_PackModel):
    """Project settings; ``sub_agents`` are keys of this pack's sub-agents."""

    name: ProjectName
    description: str = Field(default="", max_length=10_000)
    system_prompt: str = Field(default="", max_length=100_000)
    accent: ProjectAccent | None = None
    goal: str = Field(default="", max_length=MAX_GOAL_CHARS)
    sub_agents: tuple[ItemKey, ...] = Field(default=(), max_length=MAX_SUB_AGENTS)


class PackManifest(_PackModel):
    """Version 1 of the team-pack file. Unknown sections and fields are rejected."""

    format: Literal["asterism.team-pack"]
    format_version: Literal[1]
    pack: PackIdentity
    sub_agents: tuple[PackSubAgent, ...] = Field(default=(), max_length=MAX_SUB_AGENTS)
    skills: tuple[PackSkill, ...] = Field(default=(), max_length=MAX_SKILLS)
    templates: tuple[PackTemplate, ...] = Field(default=(), max_length=MAX_TEMPLATES)
    rubrics: tuple[PackRubric, ...] = Field(default=(), max_length=MAX_RUBRICS)
    project: PackProject | None = None


def _error_path(path: str) -> str:
    return path if len(path) <= MAX_ERROR_PATH_LENGTH else f"{path[:MAX_ERROR_PATH_LENGTH]}…"


def _reject_duplicate_fields(pairs: list[tuple[str, object]]) -> dict[str, object]:
    fields = dict(pairs)
    if len(fields) != len(pairs):
        raise BadDataException("Pack must not contain duplicate fields")
    return fields


def _reject_constant(_: str) -> None:
    raise BadDataException("Pack must not contain NaN or Infinity")


def _decode(source: bytes) -> object:
    if len(source) > MAX_PACK_BYTES:
        raise BadDataException(f"Pack exceeds {MAX_PACK_BYTES} bytes")
    try:
        return json.loads(
            source.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_fields,
            parse_constant=_reject_constant,
        )
    except UnicodeDecodeError as exc:
        raise BadDataException("Pack must be valid UTF-8") from exc
    except RecursionError as exc:
        raise BadDataException(f"Pack exceeds {MAX_PACK_DEPTH} levels of nesting") from exc
    except ValueError as exc:
        raise BadDataException("Pack must be valid JSON") from exc


def _check_format(root: object) -> None:
    if not isinstance(root, dict):
        raise BadDataException("Pack must be a JSON object")
    if root.get("format") != PACK_FORMAT:
        raise BadDataException(f"Pack format must be '{PACK_FORMAT}'")
    version = root.get("format_version")
    if type(version) is not int or version != PACK_FORMAT_VERSION:
        raise BadDataException(f"Unsupported pack format version; expected {PACK_FORMAT_VERSION}")


def _is_credential_name(name: str) -> bool:
    compact = re.sub(r"[^a-z0-9]", "", name.lower())
    if any(part in compact for part in _CREDENTIAL_NAME_PARTS) or compact.endswith("token"):
        return True
    return any(word.lower() == "token" for word in _NAME_WORD.findall(name))


def _screen_text(text: str, path: str) -> None:
    try:
        text.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise BadDataException(f"Pack text at {_error_path(path)} must be valid UTF-8") from exc
    if "\x00" in text:
        raise BadDataException(f"Pack text at {_error_path(path)} must not contain null characters")
    if _CREDENTIAL_VALUE.search(text):
        raise BadDataException(f"Pack text at {_error_path(path)} looks like a credential")


def _screen(root: object) -> None:
    """Bound nesting and reject credential-shaped names and values anywhere."""
    stack: list[tuple[object, str, int]] = [(root, "$", 1)]
    while stack:
        node, path, depth = stack.pop()
        if isinstance(node, str):
            _screen_text(node, path)
        elif isinstance(node, (dict, list)):
            if depth > MAX_PACK_DEPTH:
                raise BadDataException(f"Pack exceeds {MAX_PACK_DEPTH} levels of nesting")
            if isinstance(node, list):
                stack.extend((value, f"{path}[{index}]", depth + 1) for index, value in enumerate(node))
                continue
            for key, value in node.items():
                _screen_text(key, path)
                if _is_credential_name(key):
                    raise BadDataException(f"Pack has a credential-shaped field under {_error_path(path)}")
                stack.append((value, f"{path}.{key}", depth + 1))


def folded_name(text: str) -> str:
    return " ".join(text.split()).casefold()


def _require_unique(values: Iterable[str], label: str) -> None:
    seen = list(values)
    if len(set(seen)) != len(seen):
        raise BadDataException(f"Pack {label} must be unique")


def _check_sub_agent(agent: PackSubAgent) -> None:
    _require_unique(agent.requested_tools, f"sub-agent '{agent.key}' requested tools")
    if set(agent.requested_tools) & INTERNAL_TOOL_NAMES:
        raise BadDataException(f"Sub-agent '{agent.key}' requests an internal tool, which is managed by context")
    if agent.requested_tools and not agent.model_requirements.tools:
        raise BadDataException(f"Sub-agent '{agent.key}' requests tools, so its model requirements must include tools")


def check_item[T, R](key: str, document: T, parser: Callable[[T], R]) -> R:
    try:
        return parser(document)
    except BadDataException as exc:
        raise BadDataException(f"Pack item '{key}': {exc}") from exc


def _check_semantics(manifest: PackManifest) -> None:
    if not (manifest.sub_agents or manifest.skills or manifest.templates or manifest.rubrics or manifest.project):
        raise BadDataException("Pack must contain at least one item")
    _require_unique((agent.key for agent in manifest.sub_agents), "sub-agent keys")
    _require_unique((skill.key for skill in manifest.skills), "skill keys")
    _require_unique((template.key for template in manifest.templates), "template keys")
    _require_unique((rubric.key for rubric in manifest.rubrics), "rubric keys")
    _require_unique((folded_name(agent.name) for agent in manifest.sub_agents), "sub-agent names")
    for agent in manifest.sub_agents:
        _check_sub_agent(agent)
    skills = [check_item(skill.key, skill.content, parse_skill) for skill in manifest.skills]
    _require_unique((skill.name for skill in skills), "skill names")
    for template in manifest.templates:
        check_item(template.key, template.document, parse_document)
    _require_unique((folded_name(item.document.name) for item in manifest.templates), "template names")
    for rubric in manifest.rubrics:
        check_item(rubric.key, rubric.document, parse_rubric)
    _require_unique((folded_name(item.document.name) for item in manifest.rubrics), "rubric names")
    if manifest.project is not None:
        _require_unique(manifest.project.sub_agents, "project sub-agents")
        if set(manifest.project.sub_agents) - {agent.key for agent in manifest.sub_agents}:
            raise BadDataException("Pack project selects a sub-agent the pack does not define")


def parse_pack(source: bytes) -> PackManifest:
    """Validate raw pack bytes and return the manifest, or raise BadDataException.

    Size is bounded before decoding and credentials are screened before schema
    validation, so no later error can echo a secret.
    """
    root = _decode(source)
    _check_format(root)
    _screen(root)
    try:
        manifest = PackManifest.model_validate_json(source, strict=True)
    except ValidationError as exc:
        error = exc.errors(include_url=False, include_input=False)[0]
        location = ".".join(str(part) for part in error["loc"])
        raise BadDataException(f"Invalid pack at {_error_path(location)}: {error['msg']}") from exc
    _check_semantics(manifest)
    return manifest


def serialize_pack(manifest: PackManifest) -> bytes:
    """The canonical pack file; refuses output that could not be parsed back."""
    source = manifest.model_dump_json().encode("utf-8")
    if len(source) > MAX_PACK_BYTES:
        raise BadDataException(f"Pack exceeds {MAX_PACK_BYTES} bytes")
    return source


def pack_json_schema() -> dict:
    """The published JSON Schema. Semantic rules are enforced only by parse_pack."""
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": PACK_SCHEMA_ID,
        **PackManifest.model_json_schema(),
    }
