"""What the settings export carries, for every Admin Settings item (EPIC-100).

Each entry names where a setting is stored, the Admin Settings section that
edits it, and either the bundle field that carries it or why it is left out.
``missing`` lists the parts of an exported setting that the file does not carry
yet. A test fails when a stored admin setting is not listed here, so a new
setting can't be left out of the export by accident; the Export pane shows this
list so administrators know what a file contains.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class SettingCoverage:
    """One stored admin setting and how the export treats it.

    Attributes:
        store: Where it is stored: an ``app_settings`` key, or ``table:<name>``
            or ``files:<directory>`` for settings kept elsewhere.
        section: The Admin Settings section that edits it.
        bundle_field: The ``SettingsBundle`` field that carries it, or None.
        excluded: Why it is not exported, when ``bundle_field`` is None.
        missing: Parts of it that the file does not carry yet.
    """

    store: str
    section: str
    bundle_field: str | None = None
    excluded: str | None = None
    missing: tuple[str, ...] = field(default_factory=tuple)


COVERAGE: tuple[SettingCoverage, ...] = (
    SettingCoverage("llm_providers", "Providers", "providers"),
    SettingCoverage("draft_model_id", "Providers", "draft_model"),
    SettingCoverage("files:themes", "Theme editor", missing=("custom themes",)),
    SettingCoverage(
        "table:groups",
        "Groups",
        "groups",
        missing=("daily and monthly token budgets",),
    ),
    SettingCoverage("usage_timezone", "Usage", missing=("the usage time zone",)),
    SettingCoverage("active_tools", "Tools", "active_tools"),
    SettingCoverage("web_search_provider", "Tools", "web_search_provider"),
    SettingCoverage("image_search_provider", "Tools", "image_search_provider"),
    SettingCoverage("skills_enabled", "Skills", "skills_enabled"),
    SettingCoverage("canvas_enabled", "Canvas", "canvas_enabled"),
    SettingCoverage("memory", "Memory", "memory", missing=("which groups may use memory",)),
    SettingCoverage(
        "study_chat", "Study in chat", "study_chat", missing=("which groups may make decks and quizzes from chat",)
    ),
    SettingCoverage("chatgpt_plan_enabled", "ChatGPT Plans", "chatgpt_plan_enabled"),
    SettingCoverage("compaction", "Context compaction", "compaction"),
    SettingCoverage(
        "image_generation", "Image generation", "image_generation", missing=("which groups may make images",)
    ),
    SettingCoverage("image_generator_provider", "Image generation", "image_generator_provider"),
    SettingCoverage("image_generation_local", "Image generation", "image_generation_local"),
    SettingCoverage(
        "image_generation_onnx",
        "Image generation",
        "image_generation_onnx",
        missing=("accepted model licenses",),
    ),
    SettingCoverage("knowledge.processing", "Image captioning", "captioning"),
    SettingCoverage(
        "table:users",
        "Users",
        excluded="People and their group membership are account data, kept by a backup, not settings.",
    ),
    SettingCoverage(
        "table:educator_requests",
        "Educators",
        excluded="Who may run classes is account data, kept by a backup, not settings.",
    ),
)


def coverage_for(store: str) -> SettingCoverage | None:
    return next((entry for entry in COVERAGE if entry.store == store), None)
