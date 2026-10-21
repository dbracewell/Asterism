"""Server-only ceilings shared by runtime tools; never part of model arguments."""

import uuid
from dataclasses import dataclass

from asterism.domains.agent.delegation_scope import DelegationScope


@dataclass(frozen=True)
class ContextToolScope:
    """Immutable, server-derived ceiling for tool use inside one execution.

    Built by the chat domain (``resolve_effective_tools``) and threaded through
    ``ToolContext`` so tools never re-derive authorization from model input.
    The fields are identity/ceiling data only; possessing a scope grants nothing
    on its own — every read/write still reauthorizes against live state.

    Attributes:
        user_id: Owner whose profile/chat this scope was resolved for.
        chat_id: Chat the execution belongs to.
        project_id: Project backing the chat, if any (General chats are None).
        caller_agent_id: Agent configuration that invoked the tool.
        model_id: Model selected for the chat execution.
        file_ids: File ids allowed for retrieval/file tools in this context.
        delegation: Live sub-agent delegation selections, or None when none apply.
    """

    user_id: str
    chat_id: uuid.UUID
    project_id: uuid.UUID | None
    caller_agent_id: uuid.UUID
    model_id: uuid.UUID
    file_ids: frozenset[uuid.UUID]
    delegation: DelegationScope | None
