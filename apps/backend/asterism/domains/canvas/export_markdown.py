"""Shared canvas export helpers: Markdown parsing, file references, images and diagrams."""

import re
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from markdown_it import MarkdownIt
from markdown_it.token import Token

from .schemas import CanvasKind

if TYPE_CHECKING:
    from .diagrams import DrawnDiagram


# Drawn mermaid diagrams by fence source (ADR-0082). ``None`` (or a missing
# source) means the diagram couldn't be drawn and exports as code.
Diagrams = Mapping[str, "DrawnDiagram | None"]


DIAGRAM_NOT_DRAWN = "Diagram not drawn"


IMAGE_NOT_INCLUDED = "Image not included"


_CSS_PX_PER_INCH = 96


_TOKEN_ID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


_FILE_IMAGE = re.compile(rf"!\[([^\]\n]*)\]\(asterism-file:({_TOKEN_ID})\)")


_FILE_LINK = re.compile(rf"(?<!!)\[([^\]\n]*)\]\(asterism-file:({_TOKEN_ID})\)")


_FILE_SOURCE = re.compile(rf"^asterism-file:({_TOKEN_ID})$")


@dataclass(frozen=True)
class ExportImage:
    """A chat image loaded for an export (ADR-0083).

    ``png`` is the decoded image re-encoded as PNG, for DOCX and PDF; ``original``
    and ``extension`` are the stored file, for the ZIP. ``width`` and ``height``
    are in pixels, read as CSS pixels when the picture is sized.
    """

    png: bytes
    width: int
    height: int
    name: str
    original: bytes
    extension: str


# Images by file id; a missing id is written as a note instead.
Images = Mapping[uuid.UUID, ExportImage]


CanvasExportFormat = Literal["md", "txt", "source", "html", "docx", "pdf"]


SOURCE_EXTENSIONS: dict[str, str] = {
    "bash": "sh",
    "c": "c",
    "c#": "cs",
    "c++": "cpp",
    "cpp": "cpp",
    "csharp": "cs",
    "css": "css",
    "go": "go",
    "haskell": "hs",
    "html": "html",
    "java": "java",
    "javascript": "js",
    "js": "js",
    "json": "json",
    "jsx": "jsx",
    "kotlin": "kt",
    "lua": "lua",
    "markdown": "md",
    "perl": "pl",
    "php": "php",
    "python": "py",
    "r": "r",
    "ruby": "rb",
    "rust": "rs",
    "scala": "scala",
    "sh": "sh",
    "shell": "sh",
    "sql": "sql",
    "swift": "swift",
    "toml": "toml",
    "ts": "ts",
    "tsx": "tsx",
    "typescript": "ts",
    "xml": "xml",
    "yaml": "yaml",
    "yml": "yaml",
    "zsh": "sh",
}


def extension(kind: CanvasKind, language: str, export: CanvasExportFormat) -> str:
    if export == "source":
        return SOURCE_EXTENSIONS.get(language, "txt")
    return export


def _markdown(*, images: bool = False) -> MarkdownIt:
    # No raw HTML: exports never carry markup. Images are parsed only for DOCX
    # and PDF, which embed loaded chat images and write a note for the rest;
    # nothing is ever fetched from an image's URL.
    markdown = MarkdownIt("commonmark", {"html": False}).enable("table")
    return markdown if images else markdown.disable("image")


def _outside_code(content: str, replace: Callable[[str], str]) -> str:
    """Apply ``replace`` to the text outside fenced and indented code blocks."""
    lines = content.splitlines(keepends=True)
    code = [False] * len(lines)
    for token in _markdown().parse(content):
        if token.type in ("fence", "code_block") and token.map:
            for line in range(*token.map):
                code[line] = True
    out: list[str] = []
    chunk: list[str] = []
    for line, is_code in zip(lines, code, strict=True):
        if is_code:
            out.append(replace("".join(chunk)))
            chunk = []
            out.append(line)
        else:
            chunk.append(line)
    out.append(replace("".join(chunk)))
    return "".join(out)


def image_references(content: str) -> list[uuid.UUID]:
    """Distinct ``![…](asterism-file:<id>)`` image ids outside code, in order."""
    found: dict[uuid.UUID, None] = {}

    def collect(text: str) -> str:
        for match in _FILE_IMAGE.finditer(text):
            found.setdefault(uuid.UUID(match.group(2)), None)
        return text

    _outside_code(content, collect)
    return list(found)


def image_description(alt: str, image: ExportImage | None = None) -> str:
    return " ".join(alt.split()) or (image.name if image else "") or "image"


def image_note(alt: str) -> str:
    return f"{IMAGE_NOT_INCLUDED}: {image_description(alt)}"


def rewrite_file_references(content: str, image: Callable[[uuid.UUID, str], str]) -> str:
    """Rewrite ``asterism-file:`` references outside code for a file read elsewhere.

    ``image(file_id, alt)`` gives each image's replacement; a link becomes its
    label, since the id means nothing outside Asterism.
    """

    def replace(text: str) -> str:
        text = _FILE_IMAGE.sub(lambda m: image(uuid.UUID(m.group(2)), m.group(1)), text)
        return _FILE_LINK.sub(lambda m: m.group(1), text)

    return _outside_code(content, replace)


def _image_id(token: Token) -> uuid.UUID | None:
    """The file id of an ``asterism-file:`` image; ``None`` for any other source."""
    match = _FILE_SOURCE.match(str(token.attrs.get("src") or ""))
    return uuid.UUID(match.group(1)) if match else None


def _fit(image: ExportImage, max_width: float, max_height: float, per_px: float) -> float:
    """The picture's width in the page's unit, within the text width and height."""
    scale = min(1.0, max_width / (image.width * per_px), max_height / (image.height * per_px))
    return image.width * per_px * scale


def is_mermaid(token: Token) -> bool:
    """A fenced block whose language is ``mermaid``."""
    words = (token.info or "").strip().split(maxsplit=1)
    return token.type == "fence" and bool(words) and words[0].lower() == "mermaid"


def mermaid_sources(content: str) -> list[str]:
    """The distinct mermaid fence sources in a markdown document, in order."""
    found: dict[str, None] = {}
    for token in _markdown().parse(content):
        if is_mermaid(token) and token.content.strip():
            found.setdefault(token.content, None)
    return list(found)


def diagram_alt_text(drawn: "DrawnDiagram") -> str:
    return f"{drawn.label}: {drawn.description}" if drawn.description else drawn.label
