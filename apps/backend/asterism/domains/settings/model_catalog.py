"""Versioned first-party capability metadata for OpenAI models.

Only explicitly catalogued model families are matched. Unknown identifiers must
remain unknown rather than being inferred from their names.
"""

import re
from dataclasses import dataclass

OPENAI_MODEL_CATALOG_VERSION = "2026-03-01"


@dataclass(frozen=True)
class CatalogCapabilities:
    context_window: int | None
    supports_vision: bool | None


# Family stems are maintained explicitly. An optional dated suffix is accepted
# because OpenAI exposes both aliases and dated snapshots for these families.
_CATALOG: tuple[tuple[re.Pattern[str], CatalogCapabilities], ...] = (
    (
        re.compile(r"^gpt-4o(?:-mini)?(?:-\d{4}-\d{2}-\d{2})?$"),
        CatalogCapabilities(context_window=128_000, supports_vision=True),
    ),
    (
        re.compile(r"^gpt-4\.1(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$"),
        CatalogCapabilities(context_window=1_047_576, supports_vision=True),
    ),
    (
        re.compile(r"^o1(?:-\d{4}-\d{2}-\d{2})?$"),
        CatalogCapabilities(context_window=200_000, supports_vision=True),
    ),
    (
        re.compile(r"^o1-(?:mini|preview)(?:-\d{4}-\d{2}-\d{2})?$"),
        CatalogCapabilities(context_window=128_000, supports_vision=False),
    ),
    (
        re.compile(r"^o3(?:-\d{4}-\d{2}-\d{2})?$"),
        CatalogCapabilities(context_window=200_000, supports_vision=True),
    ),
    (
        re.compile(r"^o3-mini(?:-\d{4}-\d{2}-\d{2})?$"),
        CatalogCapabilities(context_window=200_000, supports_vision=False),
    ),
)


def get_openai_capabilities(model_id: str) -> CatalogCapabilities | None:
    """Return capabilities only for an explicitly maintained model family."""
    for pattern, capabilities in _CATALOG:
        if pattern.fullmatch(model_id):
            return capabilities
    return None
