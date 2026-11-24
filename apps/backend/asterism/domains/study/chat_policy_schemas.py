"""The decks-and-quizzes-from-chat policy shape (EPIC-98), kept apart so the
settings service can validate it without an import cycle."""

from pydantic import BaseModel, ConfigDict, Field, StrictBool


class StudyChatPolicy(BaseModel):
    """On by default; optionally for some groups only (ADR-0058 groups)."""

    model_config = ConfigDict(extra="forbid")
    enabled: StrictBool = True
    # None: every group. A list limits it to those groups.
    group_ids: list[str] | None = Field(default=None, max_length=200)
