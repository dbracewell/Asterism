"""Immutable server-derived delegation ceiling inherited by every child."""

import uuid
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class DelegationScope:
    """Which sub-agents a chat may delegate to, and which allowlist said so (ADR-0059).

    ``project_id`` is the project whose selections authorized the targets, or
    ``None`` for the main agent's General chat set; ``context_revision`` is that
    source's revision.
    """

    chat_id: uuid.UUID
    project_id: uuid.UUID | None
    context_revision: int
    agent_ids: frozenset[uuid.UUID]

    @property
    def source(self) -> Literal["general", "project"]:
        return "general" if self.project_id is None else "project"
