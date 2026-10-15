"""Server-only ceilings shared by runtime tools; never part of model arguments."""

import uuid
from dataclasses import dataclass

from asterism.domains.agent.delegation_scope import DelegationScope


@dataclass(frozen=True)
class ContextToolScope:
    user_id: str
    chat_id: uuid.UUID
    project_id: uuid.UUID | None
    caller_agent_id: uuid.UUID
    model_id: uuid.UUID
    file_ids: frozenset[uuid.UUID]
    delegation: DelegationScope | None
