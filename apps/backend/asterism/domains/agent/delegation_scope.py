"""Immutable server-derived delegation ceiling inherited by every child."""

import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class DelegationScope:
    chat_id: uuid.UUID
    project_id: uuid.UUID
    context_revision: int
    agent_ids: frozenset[uuid.UUID]
