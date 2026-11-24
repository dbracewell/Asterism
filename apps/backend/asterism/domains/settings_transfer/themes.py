"""Custom themes in the settings export (US-100.2).

The frontend's theme domain owns ``STORAGE_ROOT/themes`` (see
docs/architecture/theme-storage.md): one ``<id>.json`` per custom theme or
bundled-theme override. The export reads those files and the import writes them,
with the same rules as the theme editor: a strict schema mirrored from
``features/theme/schemas.ts`` (a test keeps the color keys in step), no
symlinks, atomic writes, and names unique across custom themes regardless of
case. An invalid file is left out of an export, as the catalog leaves it out.
"""

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, create_model

from asterism.core.exceptions import BadDataException

from .documents import ExportedTheme

THEME_COLOR_KEYS = (
    "background",
    "foreground",
    "card",
    "card-foreground",
    "popover",
    "popover-foreground",
    "primary",
    "primary-foreground",
    "secondary",
    "secondary-foreground",
    "muted",
    "muted-foreground",
    "accent",
    "accent-foreground",
    "destructive",
    "border",
    "input",
    "ring",
    "chart-1",
    "chart-2",
    "chart-3",
    "chart-4",
    "chart-5",
    "sidebar",
    "sidebar-foreground",
    "sidebar-primary",
    "sidebar-primary-foreground",
    "sidebar-accent",
    "sidebar-accent-foreground",
    "sidebar-border",
    "sidebar-ring",
)
_HEX = r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"
_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")
MAX_THEME_BYTES = 64 * 1024

ThemeColors = create_model(  # pyright: ignore[reportCallIssue]
    "ThemeColors",
    __config__=ConfigDict(extra="forbid", populate_by_name=True),
    **{key.replace("-", "_"): (str, Field(alias=key, pattern=_HEX)) for key in THEME_COLOR_KEYS},  # pyright: ignore[reportArgumentType]
)


class ThemeDocument(BaseModel):
    """A theme file's contents, as the theme editor's ``themeDataSchema`` allows."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100, pattern=r"^[^\x00-\x1f\x7f]+$")
    type: Literal["dark", "light"]
    colors: ThemeColors  # pyright: ignore[reportInvalidTypeForm]
    radius: float | None = Field(default=None, ge=0, le=1.25)
    shadow: Literal["flat", "soft"] | None = None
    density: Literal["comfortable", "compact"] | None = None


def _directory(storage_root: Path, *, create: bool) -> Path | None:
    root = storage_root.resolve()
    directory = root / "themes"
    if create:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not directory.exists():
        return None
    if directory.is_symlink() or directory.resolve() != directory:
        raise BadDataException("The theme directory is not a plain directory")
    return directory


def _validated(document: object) -> dict:
    """The document as stored: validated, then dumped without unset optional fields."""
    parsed = ThemeDocument.model_validate(document)
    return parsed.model_dump(mode="json", by_alias=True, exclude_none=True)


def read_themes(storage_root: Path) -> tuple[ExportedTheme, ...]:
    """Every valid custom theme file, in id order. Links and invalid files are left out."""
    directory = _directory(storage_root, create=False)
    if directory is None:
        return ()
    themes: list[ExportedTheme] = []
    for path in sorted(directory.glob("*.json")):
        if path.is_symlink() or not _ID.match(path.stem) or path.stat().st_size > MAX_THEME_BYTES:
            continue
        try:
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(fd, encoding="utf-8") as file:
                document = _validated(json.load(file))
        except (OSError, ValueError, ValidationError):
            continue
        themes.append(ExportedTheme(id=path.stem, document=document))
    return tuple(themes)


def check_themes(storage_root: Path, themes: tuple[ExportedTheme, ...]) -> None:
    """Refuse the import before anything is written if a theme is invalid or its name is taken."""
    names: dict[str, str] = {}
    for theme in read_themes(storage_root):
        names[str(theme.document["name"]).casefold()] = theme.id
    incoming: set[str] = set()
    for theme in themes:
        try:
            document = _validated(theme.document)
        except ValidationError as error:
            raise BadDataException(f"Theme {theme.id} in the file isn't a valid theme") from error
        name = document["name"].casefold()
        if name in incoming or names.get(name, theme.id) != theme.id:
            raise BadDataException(f"A theme named {document['name']} already exists")
        incoming.add(name)


def write_themes(storage_root: Path, themes: tuple[ExportedTheme, ...]) -> None:
    """Write each theme atomically; themes not in the file stay. Call ``check_themes`` first."""
    directory = _directory(storage_root, create=True)
    assert directory is not None
    for theme in themes:
        content = json.dumps(_validated(theme.document), indent=2) + "\n"
        handle, temporary = tempfile.mkstemp(dir=directory, prefix=".import-", suffix=".tmp")
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as file:
                file.write(content)
            os.chmod(temporary, 0o600)
            os.replace(temporary, directory / f"{theme.id}.json")
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise
