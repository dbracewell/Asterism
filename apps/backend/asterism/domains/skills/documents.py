"""Bounded, instruction-only SKILL.md parsing without executing YAML objects."""

import re
from dataclasses import dataclass

import yaml
from yaml.nodes import MappingNode, ScalarNode
from yaml.tokens import (
    AliasToken,
    AnchorToken,
    BlockMappingStartToken,
    BlockSequenceStartToken,
    FlowMappingStartToken,
    FlowSequenceStartToken,
    TagToken,
)

from asterism.core.exceptions import BadDataException

MAX_DOCUMENT_BYTES = 65_536
MAX_FRONTMATTER_BYTES = 8_192
MAX_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 1_024
_NAME = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z", re.ASCII)
_STRING_TAG = "tag:yaml.org,2002:str"


@dataclass(frozen=True)
class SkillMetadata:
    name: str
    description: str


def parse_document(content: str) -> SkillMetadata:
    """Preserve source verbatim, deriving only validated searchable metadata.

    Exactly name/description are accepted. YAML tags, aliases, anchors, nested
    values and duplicate keys are rejected before any object construction.
    """
    try:
        size = len(content.encode("utf-8"))
    except UnicodeEncodeError as exc:
        raise BadDataException("Skill content must be valid UTF-8") from exc
    if size > MAX_DOCUMENT_BYTES or "\x00" in content:
        raise BadDataException("Skill content exceeds 65536 UTF-8 bytes or contains a null character")
    lines = content.splitlines(keepends=True)
    if not lines or lines[0].rstrip("\r\n") != "---":
        raise BadDataException("Skill content must start with YAML frontmatter delimited by ---")
    end = next((i for i in range(1, len(lines)) if lines[i].rstrip("\r\n") == "---"), None)
    if end is None:
        raise BadDataException("Skill frontmatter must end with ---")
    frontmatter = "".join(lines[1:end])
    if len(frontmatter.encode("utf-8")) > MAX_FRONTMATTER_BYTES:
        raise BadDataException("Skill frontmatter exceeds 8192 UTF-8 bytes")
    if not "".join(lines[end + 1 :]).strip():
        raise BadDataException("Skill Markdown instructions must not be empty")
    try:
        mappings = 0
        for token in yaml.scan(frontmatter):
            if isinstance(token, (AliasToken, AnchorToken, TagToken, BlockSequenceStartToken, FlowSequenceStartToken)):
                raise BadDataException("YAML tags, aliases, anchors and sequences are not supported")
            if isinstance(token, (BlockMappingStartToken, FlowMappingStartToken)):
                mappings += 1
                if mappings > 1:
                    raise BadDataException("Nested skill frontmatter is not supported")
        node = yaml.compose(frontmatter, Loader=yaml.SafeLoader)
    except yaml.YAMLError as exc:
        raise BadDataException("Invalid skill frontmatter YAML") from exc
    if not isinstance(node, MappingNode):
        raise BadDataException("Skill frontmatter must be a name/description mapping")
    values: dict[str, str] = {}
    for key, value in node.value:
        if not isinstance(key, ScalarNode) or key.tag != _STRING_TAG or key.value not in {"name", "description"}:
            raise BadDataException("Only name and description frontmatter fields are supported")
        if key.value in values:
            raise BadDataException("Duplicate skill frontmatter fields are not supported")
        if not isinstance(value, ScalarNode) or value.tag != _STRING_TAG:
            raise BadDataException("Skill name and description must be strings")
        values[key.value] = value.value
    name, description = values.get("name", ""), values.get("description", "")
    if not 1 <= len(name) <= MAX_NAME_LENGTH or not _NAME.fullmatch(name):
        raise BadDataException("Skill name must be 1–64 lowercase letters/digits separated by single hyphens")
    if not description.strip() or len(description) > MAX_DESCRIPTION_LENGTH:
        raise BadDataException("Skill description must be nonempty and at most 1024 characters")
    return SkillMetadata(name=name, description=description)
